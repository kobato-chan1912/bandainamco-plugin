const axios = require('axios');

/**
 * Lấy proxy từ API và xác minh IP là Japan.
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
            console.log(`[Proxy] Lấy được ${proxyAddr}, đang xác minh IP Japan...`);

            const isJP = await verifyJapanIp(p.ip);
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
 * Xác minh IP có phải Japan không qua ip-api.com.
 * Trả về true nếu countryCode === 'JP'.
 */
async function verifyJapanIp(ip) {
    try {
        const res = await axios.get(`http://ip-api.com/json/${ip}?fields=status,country,countryCode,query`, { timeout: 10000 });
        if (res.data && res.data.status === 'success' && res.data.countryCode === 'JP') {
            return true;
        }
        return false;
    } catch (_) {
        return false;
    }
}