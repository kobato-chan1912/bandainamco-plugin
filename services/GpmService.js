const axios = require('axios');

class GpmService {
    constructor(apiUrl) {
        this.apiUrl = apiUrl;
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
        const cols = 5; const width = 200; const height = 300;
        const x = ((taskId - 1) % cols) * width;
        const y = Math.floor((taskId - 1) / cols) * height;
        const win_pos = `--window-position=${x},${y}`;

        const startRes = await axios.get(`${this.apiUrl}/profiles/start/${profileId}?addition_args=${win_pos}&window_scale=0.4&window_size=1920,1080`);
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