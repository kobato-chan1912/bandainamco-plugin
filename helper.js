const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const randomDelay = () => sleep(Math.floor(Math.random() * 1500) + 1000); // Delay 1s - 2.5s

// Hàm chờ element xuất hiện và thao tác
async function waitAndType(page, selector, text) {
    await page.waitForSelector(selector, { visible: true });
    await randomDelay(); // Ổn định UI
    await page.type(selector, text.toString(), { delay: 150 });
}

async function waitAndClick(page, selector) {
    await page.waitForSelector(selector, { visible: true });
    await randomDelay();
    await page.click(selector);
}

module.exports = { sleep, randomDelay, waitAndType, waitAndClick };