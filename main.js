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
const PhoneService = require('./services/PhoneService');
const { sleep, randomDelay, waitAndType, waitAndClick } = require('./helper');

const DEFAULT_TIMEOUT = 300000;
const RETRY_DELAY_MS = 10000;
const MAX_RETRIES = 3;
const gpm = new GpmService(process.env.GPM_API_URL);

let resultFileName = `results/Result.txt`;
if (!fs.existsSync('./results')) fs.mkdirSync('./results');

const RETRYABLE_ERROR_PATTERNS = [
    'Navigation failed',
    'net::ERR_',
    'Target closed',
    'Protocol error',
    'Session closed',
    'Protocol target closed',
    'Connection refused',
    'Execution context was destroyed',
    'Cannot find context',
    'PAGE_GOTO_TIMEOUT',
    'Navigation timeout',
    'TimeoutError',
    'Cannot read properties of null',
    'Waiting for',
    'failed'
];

function isRetryableError(error) {
    const msg = error.message || '';
    return RETRYABLE_ERROR_PATTERNS.some(p => msg.includes(p));
}

/**
 * Kiểm tra body có text "SĐT đã dùng" hay không.
 * Gọi sau khi điền SĐT + click confirm.
 */
async function checkDuplicatePhone(page) {
    const bodyText = await page.evaluate(() => document.body.innerText);
    return bodyText.includes('入力した電話番号は既に使用されています');
}

/**
 * Sau khi click #btn-agree-b, kiểm tra xem trang có nhảy thẳng
 * sang bước kiểm tra btn-to-service/btn-next hay không
 * (thay vì chờ OTP Email).
 *
 * Trả về true nếu đã nhảy (đã xử lý tự động), false nếu chưa nhảy.
 */
async function handleSkipToServiceNext(page, taskId) {
    try {
        await page.waitForSelector('#btn-to-service, #btn-next', { visible: true, timeout: 5000 });
        console.log(`[Luồng ${taskId}] Trang nhảy thẳng sang bước btn-to-service/btn-next (không cần OTP Email)`);

        try {
            await page.waitForSelector('#btn-to-service', { visible: true, timeout: 3000 });
            await randomDelay();
            await page.click('#btn-to-service');
            console.log(`[Luồng ${taskId}] Đã click #btn-to-service`);
            await sleep(2000);
        } catch (_) { }

        try {
            await page.waitForSelector('#btn-next', { visible: true, timeout: 3000 });
            await randomDelay();
            await page.click('#btn-next');
            console.log(`[Luồng ${taskId}] Đã click #btn-next`);
            await sleep(2000);
        } catch (_) { }

        return true;
    } catch (_) {
        return false;
    }
}

async function processTask(row, sdt, taskId) {
    const linkShiten = row[1];
    const timeLoai = row[2];
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
        console.log(`[Luồng ${taskId}] Bắt đầu chạy Email: ${email}, SĐT: ${sdt}`);

        // 2. Lấy Proxy
        const proxy = await ProxyService.getProxy();
        if (!proxy) throw new Error("Không lấy được Proxy");

        // 3. Khởi tạo GPM
        profileId = await gpm.createProfile(proxy, `Namco_${email}`);
        const debuggingPort = await gpm.startProfile(profileId, taskId);
        await sleep(3000);

        browser = await puppeteer.connect({
            browserURL: `http://127.0.0.1:${debuggingPort}`,
            defaultViewport: null,
        });

        const page = (await browser.pages())[0];
        page.setDefaultTimeout(DEFAULT_TIMEOUT);

        await sleep(10000);

        // BƯỚC 2: Vào link signup (timeout 3 phút, đợi navigation xong)
        try {
            await page.goto("https://account.bandainamcoid.com/signup.html?client_id=namcoparks_onlinestore&redirect_uri=https%3A%2F%2Fparks2.bandainamco-am.co.jp%2Fmember_regist_new.html", { waitUntil: 'networkidle2', timeout: 180000 });
        } catch (e) {
            throw new Error("PAGE_GOTO_TIMEOUT: Không navigate được sau 3 phút - " + e.message);
        }

        await page.waitForSelector('#language', { visible: true });
        await page.select('#language', 'ja');
        await randomDelay();
        await waitAndClick(page, '#btn-lang-select');
        await sleep(5000);

        console.log(`[Luồng ${taskId}] Điền thông tin Email và Mật khẩu...`);
        await waitAndType(page, '#mail', email);
        await waitAndType(page, '#pass', mkNamco);
        await waitAndClick(page, '#btn-idpw-next');

        // Chờ trang load & kiểm tra nếu region bị chặn
        await sleep(10000);
        const bodyText = await page.evaluate(() => document.body.innerText || '');
        if (bodyText.includes('お客様のご登録頂いている国／地域では、このサービスにはログインすることができません')) {
            console.log(`[Luồng ${taskId}] ⚠ Region bị chặn. Bỏ qua email ${email}, giữ SĐT ${sdt} cho lần sau.`);
            statusMsg = 'Region bị chặn (JP region required)';
            // Không ghi SĐT vào phones.txt → giữ nguyên cho account sau
            return statusMsg;
        }

        const jumpedToService = await handleSkipToServiceNext(page, taskId);




        if (!jumpedToService) {

            // BƯỚC 3: Điền ngày tháng năm
            console.log(`[Luồng ${taskId}] Điền thông tin Ngày sinh...`);
            await waitAndType(page, '#id_year', nam);
            await waitAndType(page, '#id_month', thang);
            await waitAndType(page, '#id_day', ngay);
            await randomDelay();
            await page.evaluate(() => {
                document.querySelector('input#confirm').click();
            });
            await waitAndClick(page, '#btn-agree-b');

    
            // BƯỚC 4: Chờ OTP Mail (bình thường)
            console.log(`[Luồng ${taskId}] Đang chờ OTP Email...`);
            let emailOtp = null;
            for (let i = 0; i < 30; i++) {
                emailOtp = await MailService.getEmailOtp(accountForMailApi);
                if (emailOtp) break;
                await sleep(6000);
            }
            if (!emailOtp) throw new Error("Không lấy được OTP Email");

            await randomDelay();
            await waitAndType(page, '#authcode', emailOtp);
            await waitAndClick(page, '#btn-auth');
        }

        if (!jumpedToService) {
            // BƯỚC 5: Tick checkbox Quảng cáo, Phân tích
            console.log(`[Luồng ${taskId}] Tick checkbox Quảng cáo, Phân tích...`);
            await page.waitForSelector('.c-checkbox__text', { visible: true });
            await randomDelay();

            await page.evaluate(() => {
                const spans = Array.from(document.querySelectorAll('.c-checkbox__text'));
                const adSpan = spans.find(s => s.textContent.trim() === '広告出稿');
                if (adSpan) adSpan.click();
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

            // BƯỚC 8: Kiểm tra btn-to-service / btn-next
            console.log(`[Luồng ${taskId}] Kiểm tra btn-to-service / btn-next (nếu có)...`);
            await sleep(10000);

            try {
                await page.waitForSelector('#btn-to-service', { visible: true, timeout: 5000 });
                await randomDelay();
                await page.click('#btn-to-service');
                console.log(`[Luồng ${taskId}] Đã click #btn-to-service`);
                await sleep(2000);
            } catch (_) {
                console.log(`[Luồng ${taskId}] Không có nút #btn-to-service, bỏ qua.`);
            }

            try {
                await page.waitForSelector('#btn-next', { visible: true, timeout: 5000 });
                await randomDelay();
                await page.click('#btn-next');
                console.log(`[Luồng ${taskId}] Đã click #btn-next`);
                await sleep(2000);
            } catch (_) {
                console.log(`[Luồng ${taskId}] Không có nút #btn-next, bỏ qua.`);
            }
        } else {
            console.log(`[Luồng ${taskId}] Đã nhảy tới bước SĐT, bỏ qua bước 5-8.`);
        }

        // BƯỚC 9: Điền form chi tiết Namco
        console.log(`[Luồng ${taskId}] Điền thông tin chi tiết Namco...`);
        const nickname = email.split('@')[0];
        await waitAndType(page, '#NICKNAME', nickname);
        await randomDelay();
        await waitAndType(page, '#PASSWORD', mkNamco);
        await randomDelay();
        console.log(`[Luồng ${taskId}] Điền lại mật khẩu: ${mkNamco}`);
        await page.evaluate((pass) => {
            const input2 = document.querySelector('#PASSWORD2');
            input2.value = pass;
            input2.dispatchEvent(new Event('input', { bubbles: true }));
            input2.dispatchEvent(new Event('change', { bubbles: true }));
        }, mkNamco);
        await sleep(5000);
        await randomDelay();
        console.log(`[Luồng ${taskId}] Chọn giới tính ...`);
        await page.evaluate(() => {
            document.querySelector('#MEMBER_INPUT_SEX_FEMALE_INPUT').click();
        });

        await randomDelay();
        const prefs = ["千葉県", "埼玉県"];
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
        await randomDelay();
        await sleep(2000);
        await page.evaluate(() => {
            document.querySelector('#agreement2').click();
        });
        await randomDelay();

        await page.evaluate(() => {
            document.querySelector('.js_btn-active').click();
        });

        // === CHECK SĐT ĐÃ DÙNG NGAY SAU KHI CLICK CONFIRM ===
        await sleep(8000);
        const isDuplicate = await checkDuplicatePhone(page);
        if (isDuplicate) {
            console.log(`[Luồng ${taskId}] SĐT ${sdt} đã được sử dụng (DUPLICATE). Bỏ qua account.`);
            PhoneService.writePhones(sdt, 'DUPLICATE');
            statusMsg = `SĐT đã sử dụng: ${sdt}`;
            // Ghi kết quả account
            const finalLine = `${email} | ${mkNamco} | ${hoDem} | ${ten} | ${statusMsg}\n`;
            fs.appendFileSync(resultFileName, finalLine);
            return statusMsg;
        }

        // BƯỚC 10: Confirm & Xác nhận OTP SĐT
        console.log(`[Luồng ${taskId}] Xác nhận đăng ký...`);
        await page.evaluate(() => {
            document.querySelector('input[value="登録する"]').click();
        });

        console.log(`[Luồng ${taskId}] Đang chờ OTP SĐT Telegram (${sdt})...`);
        const smsOtp = await TelegramService.waitSmsOtp(sdt, 180000);
        if (!smsOtp) {
            // Ghi NO_OTP vào phones.txt → lần sau bỏ qua SĐT này, email cũng bỏ qua vì thiếu SĐT
            PhoneService.writePhones(sdt, 'NO_OTP');
            statusMsg = `Không nhận được OTP SĐT: ${sdt}`;
            const finalLine = `${email} | ${mkNamco} | ${hoDem} | ${ten} | ${statusMsg}\n`;
            fs.appendFileSync(resultFileName, finalLine);
            return statusMsg;
        }

        await waitAndType(page, '#AUTH_CODE', smsOtp);
        await randomDelay();

        await page.evaluate(() => {
            document.querySelector('input[value="認証する"]').click();
        });

        await sleep(10000);

        console.log(`[Luồng ${taskId}] ✅ Đăng ký thành công email ${email}!`);
        statusMsg = 'Đăng ký thành công';

        PhoneService.writePhones(sdt, 'SUCCESS');

    } catch (error) {
        console.log(`[Luồng ${taskId}] Lỗi: ${error.message}`);
        statusMsg = error.message;
        // Re-throw retryable error để processTaskWithRetry xử lý
        if (isRetryableError(error)) {
            throw error;
        }
    } finally {
        const finalLine = `${email} | ${mkNamco} | ${hoDem} | ${ten} | ${statusMsg}\n`;
        fs.appendFileSync(resultFileName, finalLine);

        if (browser) try { await browser.disconnect(); } catch (_) { }
        if (profileId) await gpm.closeAndDeleteProfile(profileId);
    }
    return statusMsg;
}

/**
 * Retry wrapper: nếu lỗi là Puppeteer/network → nghỉ 10s → thử lại (max 3 lần)
 */
async function processTaskWithRetry(row, sdt, taskId) {
    let lastError = null;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            return await processTask(row, sdt, taskId);
        } catch (outerError) {
            lastError = outerError;
            if (isRetryableError(outerError)) {
                if (attempt < MAX_RETRIES) {
                    console.log(`[Luồng ${taskId}] Lỗi Puppeteer/Network: ${outerError.message}`);
                    console.log(`[Luồng ${taskId}] Nghỉ ${RETRY_DELAY_MS / 1000}s rồi thử lại (lần ${attempt + 1}/${MAX_RETRIES})...`);
                    await sleep(RETRY_DELAY_MS);
                } else {
                    console.log(`[Luồng ${taskId}] Đã retry ${MAX_RETRIES} lần vẫn lỗi. Bỏ qua (SĐT chưa dùng, sẽ retry lần sau).`);
                    // Không ghi SĐT vào phones.txt → để nó còn đó, chạy lại lần sau
                    const emailRetry = row[4] || 'unknown';
                    const mkRetry = row[8] || '';
                    const finalLine = `${emailRetry} | ${mkRetry} | ${row[12] || ''} | ${row[13] || ''} | RETRY_FAIL: ${outerError.message}\n`;
                    fs.appendFileSync(resultFileName, finalLine);
                }
            } else {
                throw outerError;
            }
        }
    }
}

// --- KHỞI CHẠY ---
async function main() {
    if (!fs.existsSync('./dau-vao.xlsx')) {
        console.log("❌ Lỗi: Không tìm thấy file dau-vao.xlsx");
        process.exit(1);
    }

    await TelegramService.initTelegram();

    const workbook = xlsx.readFile('./dau-vao.xlsx');
    const sheetName = workbook.SheetNames[0];
    const excelData = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1 }).slice(1);

    if (excelData.length === 0) {
        console.log("❌ Lỗi: File Excel không có dữ liệu (Chỉ có header).");
        process.exit(1);
    }

    // Load danh sách SĐT từ phones.txt
    const allPhones = PhoneService.getAllPhones();

    // Lấy danh sách email từ Excel (giữ index gốc trong excelData)
    const emailData = excelData
        .map((row, idx) => ({ row, originalIndex: idx }))
        .filter(item => item.row[4]);

    // Ghép email với SĐT theo index (email[0] ↔ phones[0], email[1] ↔ phones[1], ...)
    const pendingTasks = [];

    for (let i = 0; i < emailData.length; i++) {
        const item = emailData[i];
        const row = item.row;
        const originalIndex = item.originalIndex;
        if (!allPhones[i]) {
            console.log(`   ⏭ Email ${row[4]} không có SĐT tương ứng (index ${i}), bỏ qua.`);
            continue;
        }
        const sdt = allPhones[i].phone;
        const phoneResult = PhoneService.getPhoneResult(sdt);
        if (phoneResult !== null) {
            console.log(`   ⏭ Bỏ qua SĐT ${sdt} (đã xử lý: ${phoneResult})`);
            continue;
        }
        pendingTasks.push({ row, sdt, email: row[4], originalIndex });
    }

    console.log(`\n📋 Tổng email: ${emailData.length}, Tổng SĐT: ${allPhones.length}`);
    console.log(`📋 Cần chạy: ${pendingTasks.length} account\n`);

    if (pendingTasks.length === 0) {
        console.log("✅ Không có account nào cần chạy!");
        process.exit(0);
    }

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question('\nNhập số luồng chạy song song (Mặc định 1): ', async (answer) => {
        const threadCount = parseInt(answer) || 1;
        rl.close();
        console.log(`🚀 Bắt đầu với ${threadCount} luồng...\n`);

        const limit = pLimit(threadCount);
        const excelResults = [];
        const promises = pendingTasks.map((task, idx) => {
            return limit(async () => {
                let status = null;
                try {
                    status = await processTaskWithRetry(task.row, task.sdt, idx + 1);
                } catch (e) {
                    status = e.message || 'Unknown error';
                }
                excelResults.push({
                    email: task.email,
                    originalIndex: task.originalIndex,
                    status: status || 'Unknown',
                });
            });
        });

        await Promise.all(promises);

        // Ghi status vào cột T của dau-vao.xlsx (sau khi tất cả luồng chạy xong)
        if (excelResults.length > 0) {
            writeExcelStatus(excelResults);
        }

        console.log("\n=========================================");
        console.log(`📄 Data đã lưu vào file: ${resultFileName}`);
        console.log(`📄 SĐT đã lưu vào file: config/phones.txt`);
        console.log("=========================================\n");
        process.exit(0);
    });
}

/**
 * Ghi trạng thái từng email vào cột T (index 19) của dau-vao.xlsx
 * results: [{ email, status, originalIndex }]
 */
function writeExcelStatus(results) {
    try {
        const workbook = xlsx.readFile('./dau-vao.xlsx');
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];

        // Đảm bảo cột T có header
        const headerRow = xlsx.utils.sheet_to_json(sheet, { header: 1 })[0] || [];
        if (!headerRow[19] || headerRow[19] !== 'Status') {
            const cellRef = xlsx.utils.encode_cell({ r: 0, c: 19 });
            sheet[cellRef] = { t: 's', v: 'Status' };
        }

        let written = 0;
        for (const { email, status, originalIndex } of results) {
            // originalIndex là index trong emailData (đã filter row có email)
            // Cần map ngược lại index trong excelData
            // Lưu ý: excelData.slice(1) đã bỏ header, nên originalIndex = vị trí trong sheet (0-based từ dòng 2)
            const rowIdx = originalIndex + 1; // +1 vì có header
            const cellRef = xlsx.utils.encode_cell({ r: rowIdx, c: 19 });
            sheet[cellRef] = { t: 's', v: status || '' };
            written++;
        }

        // Cập nhật range để bao gồm cột T
        const range = xlsx.utils.decode_range(sheet['!ref'] || 'A1');
        if (range.e.c < 19) range.e.c = 19;
        sheet['!ref'] = xlsx.utils.encode_range(range);

        xlsx.writeFile(workbook, './dau-vao.xlsx');
        console.log(`📝 Đã ghi status vào cột T của dau-vao.xlsx (${written} dòng).`);
    } catch (e) {
        console.log(`❌ Lỗi ghi Excel: ${e.message}`);
    }
}

main();
