require('dotenv').config({ path: './config/.env' });
const fs = require('fs');
const xlsx = require('xlsx');
const puppeteer = require('puppeteer-core');
const pLimit = require('p-limit');
const readline = require('readline');

const GpmService = require('./services/GpmService');
const ProxyService = require('./services/ProxyService');
const MailService = require('./services/MailService');
const TelegramService = require('./services/TelegramService');
const { sleep, randomDelay, waitAndType, waitAndClick } = require('./helper');

const MAX_TIMEOUT_MS = 300000;
const DEFAULT_TIMEOUT = 300000;
const gpm = new GpmService(process.env.GPM_API_URL);

let resultFileName = `results/Result-${Date.now()}.txt`;
if (!fs.existsSync('./results')) fs.mkdirSync('./results');

async function processTask(row, taskId) {
    // Đọc Data theo Index (0 to 19)
    const linkShiten = row[1];
    const timeLoai = row[2];
    const sdt = row[3];
    const email = row[4];
    const passMail = row[5];
    const tokenFresh = row[6];
    const clientId = row[7];
    const mkNamco = row[8];
    const ngay = row[9];
    const thang = row[10];
    const nam = row[11];
    const hoDem = row[12];
    const ten = row[13];
    const hoKata = row[14];
    const tenKata = row[15];
    const zip = row[16];
    const banchi = row[17];
    const room = row[18];

    const accountForMailApi = `${email}|${passMail}|${tokenFresh}|${clientId}`;

    let profileId = null;
    let browser = null;
    let statusMsg = "Lỗi không xác định";

    try {
        console.log(`[Luồng ${taskId}] Bắt đầu chạy Email: ${email}`);

        // Lấy Proxy
        const proxy = await ProxyService.getProxy();
        if (!proxy) throw new Error("Không lấy được Proxy");

        // 1. Khởi tạo GPM
        profileId = await gpm.createProfile(proxy, `Namco_${email}`);
        const debuggingPort = await gpm.startProfile(profileId, taskId);
        await sleep(3000);

        browser = await puppeteer.connect({
            browserURL: `http://127.0.0.1:${debuggingPort}`,
            defaultViewport: null,
        });

        const page = (await browser.pages())[0];
        page.setDefaultTimeout(DEFAULT_TIMEOUT);

        await sleep(10000)

        // BƯỚC 2: Vào link signup
        await page.goto("https://account.bandainamcoid.com/signup.html?client_id=namcoparks_onlinestore&redirect_uri=https%3A%2F%2Fparks2.bandainamco-am.co.jp%2Fmember_regist_new.html");

        await page.waitForSelector('#language', { visible: true });
        await page.select('#language', 'ja'); // Chọn value "ja" cho 日本語
        await randomDelay();
        await waitAndClick(page, '#btn-lang-select'); // Click nút xác nhận ngôn ngữ
        await sleep(5000); // Chờ load lại trang

        console.log(`[Luồng ${taskId}] Điền thông tin Email và Mật khẩu...`);
        await waitAndType(page, '#mail', email);
        await waitAndType(page, '#pass', mkNamco);
        await waitAndClick(page, '#btn-idpw-next');

        // BƯỚC 3: Điền ngày tháng năm
        console.log(`[Luồng ${taskId}] Điền thông tin Ngày sinh...`);
        await waitAndType(page, '#id_year', nam);
        await waitAndType(page, '#id_month', thang);
        await waitAndType(page, '#id_day', ngay);
        // Tick checkbox agree (dùng selector thông minh)
        await randomDelay();
        await page.evaluate(() => {
            document.querySelector('input#confirm').click();
        });
        await waitAndClick(page, '#btn-agree-b');

        // BƯỚC 4: Chờ OTP Mail
        console.log(`[Luồng ${taskId}] Đang chờ OTP Email...`);
        let emailOtp = null;
        for (let i = 0; i < 30; i++) { // Chờ max ~3 phút (30 lần * 6s)
            emailOtp = await MailService.getEmailOtp(accountForMailApi);
            if (emailOtp) break;
            await sleep(6000);
        }
        if (!emailOtp) throw new Error("Không lấy được OTP Email");

        await randomDelay();
        await waitAndType(page, '#authcode', emailOtp);
        await waitAndClick(page, '#btn-auth');

        // BƯỚC 5: Tick checkbox Quảng cáo, Phân tích
        console.log(`[Luồng ${taskId}] Tick checkbox Quảng cáo, Phân tích...`);

        await page.waitForSelector('.c-checkbox__text', { visible: true });
        await randomDelay();

        await page.evaluate(() => {
            const spans = Array.from(document.querySelectorAll('.c-checkbox__text'));

            // Tìm span có chữ "広告出稿" (Quảng cáo) và click
            const adSpan = spans.find(s => s.textContent.trim() === '広告出稿');
            if (adSpan) adSpan.click();

            // Tìm span có chữ "分析" (Phân tích) và click
            const analyticsSpan = spans.find(s => s.textContent.trim() === '分析');
            if (analyticsSpan) analyticsSpan.click();
        });

        await randomDelay();
        await waitAndClick(page, '#btn-accept-all');

        // BƯỚC 6: Thêm thông tin
        await waitAndClick(page, '#btn-add');
        await randomDelay();

        // BƯỚC 7: Chọn nữ -> Submit -> Back
        await sleep(5000);
        console.log(`[Luồng ${taskId}] Chọn giới tính Nữ và Submit...`);
        await page.waitForSelector('#gender--1', { visible: true });
        await randomDelay();
        await page.evaluate(() => {
            document.querySelector('#gender--1').click();
        });
        await sleep(5000);
        await waitAndClick(page, '#btn-regist');
        await sleep(5000);
        await waitAndClick(page, '#btn-back');

        // Bước bị thiếu
        // Bước bị thiếu: Xử lý 2 nút tuỳ chọn
        console.log(`[Luồng ${taskId}] Kiểm tra btn-to-service / btn-next (nếu có)...`);

        // Ngủ một nhịp cho trang load xong hẳn các trạng thái
        await sleep(10000);

        // 1. Kiểm tra btn-to-service
        try {
            // Chỉ đợi tối đa 4 giây, nếu có thì click, không có thì nhảy xuống catch
            await page.waitForSelector('#btn-to-service', { visible: true, timeout: 10000 });
            await randomDelay();
            await page.click('#btn-to-service');
            console.log(`[Luồng ${taskId}] Đã click #btn-to-service`);
            await sleep(2000); // Đợi 1 chút cho UI thay đổi sau click
        } catch (e) {
            console.log(`[Luồng ${taskId}] Không có nút #btn-to-service, bỏ qua.`);
        }

        // 2. Kiểm tra btn-next
        try {
            // Tương tự, đợi tối đa 4 giây
            await page.waitForSelector('#btn-next', { visible: true, timeout: 10000 });
            await randomDelay();
            await page.click('#btn-next');
            console.log(`[Luồng ${taskId}] Đã click #btn-next`);
            await sleep(2000);
        } catch (e) {
            console.log(`[Luồng ${taskId}] Không có nút #btn-next, bỏ qua.`);
        }


        // BƯỚC 8: Điền form chi tiết Namco
        console.log(`[Luồng ${taskId}] Điền thông tin chi tiết Namco...`);
        const nickname = email.split('@')[0];
        await waitAndType(page, '#NICKNAME', nickname);
        await randomDelay();
        await waitAndType(page, '#PASSWORD', mkNamco);
        await randomDelay();
        console.log(`[Luồng ${taskId}] Điền lại mật khẩu: ${mkNamco}`);
        await page.evaluate((pass) => {
            const input2 = document.querySelector('#PASSWORD2');
            input2.value = pass; // Bơm thẳng text vào
            // Bắn event để qua mặt các JS framework (React, Vue, jQuery)
            input2.dispatchEvent(new Event('input', { bubbles: true }));
            input2.dispatchEvent(new Event('change', { bubbles: true }));
        }, mkNamco);
        await sleep(5000); // Chờ 2s trước khi điền lại mật khẩu
        await randomDelay();
        console.log(`[Luồng ${taskId}] Chọn giới tính ...`);
        await page.evaluate(() => {
            document.querySelector('#MEMBER_INPUT_SEX_FEMALE_INPUT').click();
        });

        // Random Prefecture (Tokyo, Chiba, Saitama - Tùy chỉnh value theo trang web)
        await randomDelay();
        const prefs = ["千葉県", "埼玉県"]; // Giả sử value của thẻ select: Tokyo=13, Chiba=12, Saitama=11
        const randomPref = prefs[Math.floor(Math.random() * prefs.length)];

        console.log(`[Luồng ${taskId}] Chọn Prefecture ngẫu nhiên: ${randomPref}`);
        await randomDelay();
        await page.waitForSelector('#ADDR1');
        await page.select('#ADDR1', randomPref);
        await randomDelay();

        console.log(`[Luồng ${taskId}] Điền SĐT: ${sdt} và Tick checkbox...`);

        await sleep(2000);
        await waitAndType(page, '#TEL', sdt);
        await page.evaluate(() => {
            document.querySelector('#agreement1').click();
        });
        await randomDelay(); await sleep(2000); // Chờ 2s trước khi tick tiếp
        await page.evaluate(() => {
            document.querySelector('#agreement2').click();
        });
        await randomDelay();


        await waitAndClick(page, '.js_btn-active'); // Nút confirm

        // BƯỚC 9: Confirm & Xác nhận OTP SĐT
        console.log(`[Luồng ${taskId}] Xác nhận đăng ký...`);
        await waitAndClick(page, 'input[value="登録する"]');

        console.log(`[Luồng ${taskId}] Đang chờ OTP SĐT Telegram (${sdt})...`);
        const smsOtp = await TelegramService.waitSmsOtp(sdt, 180000); // Đợi 3 phút
        if (!smsOtp) throw new Error("Không OTP SĐT: " + sdt);

        await waitAndType(page, '#AUTH_CODE', smsOtp);
        await randomDelay();
        await waitAndClick(page, 'input[value="認証する"]'); // Nút Authenticate

        await sleep(10000); // Chờ 10s cho trang load xong

        console.log(`[Luồng ${taskId}] ✅ Đăng ký thành công email ${email}!`);
        statusMsg = 'Đăng ký thành công';

    } catch (error) {
        console.log(`[Luồng ${taskId}] Lỗi: ${error.message}`);
        statusMsg = error.message;
    } finally {
        // BƯỚC 15: Ghi kết quả
        const finalLine = `${email} | ${mkNamco} | ${hoDem} | ${ten} | ${statusMsg}\n`;
        fs.appendFileSync(resultFileName, finalLine);


        if (browser) try { await browser.disconnect(); } catch (e) { }
        if (profileId) await gpm.closeAndDeleteProfile(profileId);
    }
}

// --- KHỞI CHẠY ---
async function main() {
    // Bước 1: Kiểm tra config
    if (!fs.existsSync('./dau-vao.xlsx')) {
        console.log("❌ Lỗi: Không tìm thấy file dau-vao.xlsx");
        process.exit(1);
    }

    // Khởi tạo Telegram (Sẽ yêu cầu nhập OTP nếu chưa có session)
    await TelegramService.initTelegram();

    // Đọc Excel (bỏ qua dòng tiêu đề header)
    const workbook = xlsx.readFile('./dau-vao.xlsx');
    const sheetName = workbook.SheetNames[0];
    const excelData = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1 }).slice(1);

    if (excelData.length === 0) {
        console.log("❌ Lỗi: File Excel không có dữ liệu (Chỉ có header).");
        process.exit(1);
    }

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question('\nNhập số luồng chạy song song (Mặc định 1): ', async (answer) => {
        const threadCount = parseInt(answer) || 1;
        rl.close();
        console.log(`🚀 Bắt đầu quẩy siêu dự án với ${threadCount} luồng...\n`);

        const limit = pLimit(threadCount);
        const promises = excelData.map((row, index) => {
            // Check nếu hàng rỗng thì bỏ qua
            if (!row[4]) return Promise.resolve();
            return limit(() => processTask(row, index + 1));
        });

        await Promise.all(promises);

        console.log("\n=========================================");
        // console.log(`🏁 CHỐT SỔ! Đã xong ${excelData.length} account.`);
        console.log(`📄 Data đã lưu vào file: ${resultFileName}`);
        console.log("=========================================\n");
        process.exit(0);
    });
}

main();