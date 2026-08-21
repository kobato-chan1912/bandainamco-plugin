const axios = require('axios');
const { execSync } = require('child_process');

class GpmService {
    constructor(apiUrl) {
        this.apiUrl = apiUrl;
        // Tự động lấy kích thước màn hình ngay khi khởi tạo service
        this.screenSize = this.getRealScreenSize();
    }

    getRealScreenSize() {
        try {
            // Lệnh PowerShell lấy Width và Height của màn hình chính
            const cmd = `powershell -command "Add-Type -AssemblyName System.Windows.Forms; Write-Output ([System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Width, [System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Height)"`;
            const output = execSync(cmd, { encoding: 'utf8', stdio: 'pipe' });
            
            const dimensions = output.trim().split('\n');
            if (dimensions.length >= 2) {
                const width = parseInt(dimensions[0]);
                const height = parseInt(dimensions[1]);
                console.log(`[GPM Service] Phát hiện màn hình thực tế: ${width}x${height}`);
                return { width, height };
            }
        } catch (e) {
            console.log(`[GPM Service] Không bắt được màn hình, dùng mặc định 1920x1080.`);
        }
        // Fallback mặc định nếu chạy trên Linux/Mac hoặc lỗi
        return { width: 1920, height: 1080 };
    }

    async createProfile(proxy, profileName) {
        const createRes = await axios.post(`${this.apiUrl}/profiles/create`, {
            raw_proxy: proxy,
            name: profileName
        }, { timeout: 15000 });

        if (!createRes.data?.success) throw new Error("Tạo profile GPM thất bại");
        return createRes.data.data.id;
    }

   
    async startProfile(profileId, taskId) {
        // Thông số GỐC muốn fake cho bộ Anti-Detect
        const windowWidth = 1920;
        const windowHeight = 1080;
        
        // ==========================================
        // ⚙️ TÙY CHỈNH SCALE Ở ĐÂY
        // (0.25 tức là thu nhỏ giao diện đi 4 lần)
        // ==========================================
        const scale = 0.25; 
        // ==========================================

        // 1. Kích thước VẬT LÝ thực tế chiếm trên màn hình (để tính toán lưới)
        const actualWidth = Math.floor(windowWidth * scale);   // VD: 1920 * 0.25 = 480px
        const actualHeight = Math.floor(windowHeight * scale); // VD: 1080 * 0.25 = 270px

        // 2. Kích thước 1 "ô" trên lưới (cộng thêm 20px khe hở cho thoáng)
        const boxWidth = actualWidth + 20;
        const boxHeight = actualHeight + 30;

        // 3. Tính số cột dựa trên màn hình
        const screenWidth = this.screenSize.width;
        let cols = Math.floor(screenWidth / boxWidth);
        if (cols < 1) cols = 1; 

        // 4. Tính toạ độ X, Y MONG MUỐN
        const index = taskId - 1;
        const targetX = (index % cols) * boxWidth;
        const targetY = Math.floor(index / cols) * boxHeight;

        // 5. GIẢI MÃ MA THUẬT CHROMIUM:
        // Vì Chrome tự động nhân toạ độ với scale, ta phải "bơm" toạ độ lớn lên gấp (1/scale) lần
        const argX = Math.round(targetX / scale);
        const argY = Math.round(targetY / scale);

        // Kích thước truyền vào Chrome PHẢI LÀ SIZE GỐC (1920x1080)
        // Khi chạy, Chrome sẽ tự động nén cái size 1920 đó xuống thành actualWidth (480)
        const args = `--window-position=${argX},${argY} --window-size=${windowWidth},${windowHeight} --force-device-scale-factor=${scale}`;
        
        const encodedArgs = encodeURIComponent(args);

        const apiUrlCall = `${this.apiUrl}/profiles/start/${profileId}?addition_args=${encodedArgs}&window_size=${windowWidth},${windowHeight}`;
        
        const startRes = await axios.get(apiUrlCall);
        return startRes.data.data.remote_debugging_port;
    }

    async closeAndDeleteProfile(profileId) {
        try {
            await axios.get(`${this.apiUrl}/profiles/stop/${profileId}`);
            await new Promise(r => setTimeout(r, 2000));
            await axios.get(`${this.apiUrl}/profiles/delete/${profileId}?mode=hard`);
        } catch (e) { }
    }
}

module.exports = GpmService;
