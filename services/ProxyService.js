const axios = require('axios');

/**
 * Lấy proxy từ API và xác minh IP là Japan.
 * Verify bằng cách gọi API check-IP QUA CHÍNH PROXY đó (để biết IP thực sự mà proxy exit ra).
 * Retry tối đa 5 lần nếu proxy không phải JP hoặc lỗi mạng.
 */
exports.getProxy = async () => {
    const MAX_TRY = 5;
    for (let i = 0; i < MAX_TRY; i++) {
        try {
            const res = await axios.get(process.env.PROXY_URL);
            if (!res.data || res.data.code !== 200 || !res.data.data || res.data.data.length === 0) {
                console.log(`[Proxy] API không trả proxy hợp lệ (lần ${i + 1}/${MAX_TRY})`);
                continue;
            }

            const p = res.data.data[0];
            const proxyAddr = `${p.ip}:${p.port}`;
            console.log(`[Proxy] Lấy được ${proxyAddr}, đang xác minh IP Japan qua proxy...`);

            const isJP = await verifyJapanIpViaProxy(p.ip, p.port, p.username, p.password);
            if (isJP) {
                console.log(`[Proxy] ✓ ${proxyAddr} xác minh là IP Japan.`);
                return proxyAddr;
            }
            console.log(`[Proxy] ✗ ${proxyAddr} KHÔNG phải IP Japan (lần ${i + 1}/${MAX_TRY}).`);
        } catch (error) {
            console.log(`[Proxy] Lỗi lấy/verify proxy (lần ${i + 1}/${MAX_TRY}):`, error.message);
        }
    }
    console.log(`[Proxy] Đã thử ${MAX_TRY} lần nhưng không có proxy Japan nào.`);
    return null;
};

/**
 * Xác minh IP Japan bằng cách gọi API check-IP QUA CHÍNH PROXY đó.
 * Trả về true nếu countryCode === 'JP'.
 */
async function verifyJapanIpViaProxy(ip, port, username, password) {
    try {
        const proxyConfig = {
            host: ip,
            port: parseInt(port, 10),
            protocol: 'http',
        };
        if (username && password) {
            proxyConfig.auth = { username, password };
        }

        const res = await axios.get('http://ip-api.com/json/?fields=status,country,countryCode,query', {
            proxy: proxyConfig,
            timeout: 15000,
        });

        if (res.data && res.data.status === 'success' && res.data.countryCode === 'JP') {
            return true;
        }
        if (res.data && res.data.countryCode) {
            console.log(`[Proxy] Exit IP qua proxy ${ip}:${port} → country=${res.data.country}, code=${res.data.countryCode}`);
        }
        return false;
    } catch (e) {
        console.log(`[Proxy] Verify qua proxy lỗi: ${e.message}`);
        return false;
    }
}