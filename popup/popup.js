
const themeSelect = document.querySelector('#theme');
const status = document.querySelector('#status');

document.querySelector('#version').textContent =
    `v${browser.runtime.getManifest().version}`;

async function loadSettings() {
    try {
        const settings = await browser.storage.local.get({
            theme: 'lemmy'
        });

        themeSelect.value = settings.theme;
    } catch (error) {
        console.error('Failed to load settings:', error);
        status.textContent = 'Unable to load settings';
    }
}

themeSelect.addEventListener('change', async () => {
    try {
        await browser.storage.local.set({
            theme: themeSelect.value
        });

        status.textContent = 'Saved';
    } catch (error) {
        console.error('Failed to save settings:', error);
        status.textContent = 'Unable to save settings';
    }
});

loadSettings();

