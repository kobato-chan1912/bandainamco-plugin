require('dotenv').config({ path: './config/.env' });
const chalk = require('chalk');
const TelegramService = require('./services/TelegramService');

const TEST_PHONE = '08083865506'; // Số điện thoại cần test

async function runTest() {
    console.log(chalk.cyan(`🧪 BẮT ĐẦU TEST LẤY OTP TỪ SERVICE CHO SĐT: ${TEST_PHONE}\n`));

    try {
        // 1. Khởi tạo Telegram Client và bật chế độ lắng nghe (giống hệt lúc chạy main)
        await TelegramService.initTelegram();

        console.log(chalk.yellow(`\n⏳ Đang chờ OTP cho SĐT ${TEST_PHONE} (Tối đa 3 phút)...`));
        console.log(chalk.gray(`(Hãy thử gửi tin nhắn mẫu có TO: ${TEST_PHONE} vào Group 5305076532)`));

        // 2. Gọi hàm waitSmsOtp để chờ bắt OTP
        const otp = await TelegramService.waitSmsOtp(TEST_PHONE, 180000);

        if (otp) {
            console.log(chalk.greenBright(`\n🎉 [THÀNH CÔNG] Trả về OTP từ Service: `) + chalk.bgGreen.black(` ${otp} `));
        } else {
            console.log(chalk.red(`\n❌ [THẤT BẠI] Quá 3 phút không nhận được OTP.`));
        }
    } catch (error) {
        console.error(chalk.red(`Lỗi trong quá trình test: ${error.message}`));
    } finally {
        console.log(chalk.gray('\nĐóng kết nối test...'));
        process.exit(0);
    }
}

runTest();