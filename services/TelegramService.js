const { TelegramClient } = require('teleproto');
const { StringSession } = require('teleproto/sessions');
const { NewMessage } = require('teleproto/events');
const input = require('input');
const chalk = require('chalk');
const fs = require('fs');

// Biến toàn cục lưu OTP theo SĐT
global.smsStore = {}; 

exports.initTelegram = async () => {
    const apiId = parseInt(process.env.API_ID);
    const apiHash = process.env.API_HASH;
    const telegramCatchID = process.env.TELEGRAM_OTP_GROUP;
    let sessionData = "";
    
    if (fs.existsSync('./config/telegram-session.json')) {
        sessionData = JSON.parse(fs.readFileSync('./config/telegram-session.json')).session;
    }

    const stringSession = new StringSession(sessionData);
    const client = new TelegramClient(stringSession, apiId, apiHash, { connectionRetries: 5 });

    if (!sessionData) {
        await client.start({
            phoneNumber: async () => await input.text('Nhập số điện thoại Telegram (+84xxxx): '),
            password: async () => await input.text('Nhập mật khẩu 2FA (nếu có, không thì Enter): '),
            phoneCode: async () => await input.text('Nhập mã xác nhận (mở app telegram): '),
            onError: (err) => console.log('Lỗi:', err),
        });
        fs.writeFileSync('./config/telegram-session.json', JSON.stringify({ session: client.session.save() }));
        console.log(chalk.greenBright('\n✅ Lưu session Telegram thành công!'));
    } else {
        await client.connect();
    }

    const me = await client.getMe();
    console.log(chalk.greenBright(`\n✅ Đăng nhập Telegram thành công! User: ${me.username || me.firstName}`));
    console.log(chalk.gray(`(User ID: ${me.id}, Phone: ${me.phone})`));
    console.log(chalk.greenBright('\n✅ Bắt đầu nhận tin nhắn Telegram!'));
    
    client.addEventHandler(async (event) => {
        const message = event.message;
        
        // Lấy Chat ID một cách an toàn nhất (Event của NewMessage hỗ trợ sẵn)
        let chatId = event.chatId ? event.chatId.toString() : '';
                
        let cleanID = chatId.replace('-', '');
        if (cleanID.startsWith('100')) {
            cleanID = cleanID.substring(3);
        }

        // Group ID cần bắt
        if (cleanID === telegramCatchID) { 
            const msgText = message.message;
            if (!msgText) return;

            // Parse tin nhắn lấy SĐT và OTP
            const toMatch = msgText.match(/TO:\s*(\d+)/);
            const otpMatch = msgText.match(/MSG:.*?(\d{6})/s);
            
            if (toMatch && otpMatch) {
                let phone = toMatch[1];
                if(phone.startsWith('0')) phone = phone.substring(1); 
                
                const otp = otpMatch[1];
                global.smsStore[phone] = otp;
                console.log(chalk.yellow(`[Telegram] Đã nhận OTP ${otp} cho SĐT ${phone}`));
            }
        }
    }, new NewMessage({})); // <--- VŨ KHÍ BÍ MẬT LÀ CHỖ NÀY
}

// Hàm chờ lấy OTP
exports.waitSmsOtp = async (phoneNumber, timeoutMs = 180000) => {
    let phoneCheck = phoneNumber.toString().trim();
    if(phoneCheck.startsWith('0')) phoneCheck = phoneCheck.substring(1);

    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
        if (global.smsStore[phoneCheck]) {
            const otp = global.smsStore[phoneCheck];
            delete global.smsStore[phoneCheck]; // Lấy xong thì xóa
            return otp;
        }
        await new Promise(r => setTimeout(r, 3000)); // Check mỗi 3s
    }
    return null;
}