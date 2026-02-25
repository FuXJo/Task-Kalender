const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('http://localhost:5173/?date=2026-02-25');

  await page.waitForTimeout(1000);

  // Check if we are on login screen and login
  const emailInput = await page.$('input[type="email"]');
  if (emailInput) {
    await emailInput.fill('test@example.com');
    await page.fill('input[type="password"]', 'password');
    await page.click('button:has-text("Einloggen")');
    await page.waitForTimeout(2000);
  }

  try {
    const tabBtn = await page.$('button[value="kategorien"]');
    if (tabBtn) {
      await tabBtn.click();
      await page.waitForTimeout(1000);
    }
  } catch (e) {
    console.log("Error clicking: " + e.message);
  }

  const info = await page.evaluate(() => {
    const list = [];
    let el = document.querySelector('[role="tabpanel"][data-state="active"]');
    if (!el) return 'No tabpanel found';

    // Get child
    let child = el.firstElementChild;
    if (child) {
      const r = child.getBoundingClientRect();
      const st = window.getComputedStyle(child);
      list.push({ tag: 'tabpanel-child', id: child.id, class: child.className, top: r.top, height: r.height, mt: st.marginTop, pt: st.paddingTop, mb: st.marginBottom, pb: st.paddingBottom, display: st.display });
    }

    while (el && el.tagName !== 'BODY') {
      const r = el.getBoundingClientRect();
      const st = window.getComputedStyle(el);
      list.push({
        tag: el.tagName,
        id: el.id,
        class: el.className,
        top: r.top,
        height: r.height,
        display: st.display,
        flexDirection: st.flexDirection,
        justifyContent: st.justifyContent,
        alignItems: st.alignItems,
        marginTop: st.marginTop,
        paddingTop: st.paddingTop,
        flexGrow: st.flexGrow
      });
      el = el.parentElement;
    }
    return list;
  });
  console.log(JSON.stringify(info, null, 2));
  await browser.close();
})();
