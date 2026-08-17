const axios = require('axios');

exports.getEmailOtp = async (accountData) => {
    try {
        // accountData format: "Email|Pass Mail|Token fresh|ClientID"
        const form = new URLSearchParams();
        form.append('account', accountData);
        form.append('service', 'banapassport');

        const res = await axios.post('http://mail.seikozz.com/get-otp.php', form);
        if (res.data.status === 'success' && res.data.otp) {
            return res.data.otp;
        }
        return null;
    } catch (e) {
        return null;
    }
}