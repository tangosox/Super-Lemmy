
// Super Lemmy theme selection

(() => {
    const validThemes = new Set(['original', 'lemmy', 'light']);

    function applyTheme(theme) {
        const selected = validThemes.has(theme) ? theme : 'original';
        document.documentElement.dataset.slTheme = selected;
    }

    // Preserve the existing appearance until preferences load.
    applyTheme('lemmy');
    // Load saved preference.
        browser.storage.local.get({ theme: 'lemmy' })
        .then(settings => {
            applyTheme(settings.theme);
        })
        .catch(error => {
            console.error('[Super Lemmy] Theme load failed:', error);
        });

    // Update open pages immediately when the popup changes the theme.
    browser.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.theme) {
            applyTheme(changes.theme.newValue);
        }
    });
})();

