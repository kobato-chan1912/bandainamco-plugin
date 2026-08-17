const axios = require('axios');

exports.getProxy = async () => {
    try {
        const res = await axios.get(process.env.PROXY_URL);
        if (res.data && res.data.code === 200 && res.data.data.length > 0) {
            const p = res.data.data[0];
            return `${p.ip}:${p.port}`; // Format IP:PORT (Hoặc tùy biến nếu proxy có pass)
        }
        return null;
    } catch (error) {
        console.log("Lỗi lấy Proxy:", error.message);
        return null;
    }
}