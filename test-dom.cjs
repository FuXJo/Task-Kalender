const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('http://localhost:5174/?date=2026-02-25');
  await page.click('button:has-text("Kategorien")');
  await page.waitForTimeout(500);
  const info = await page.evaluate(() => {
    const tabContent = document.querySelector('[role="tabpanel"][data-state="active"]');
    const child = tabContent ? tabContent.firstElementChild : null;
    return {
      tabContentHTML: tabContent ? tabContent.outerHTML.substring(0, 300) : null,
      tabContentHeight: tabContent ? tabContent.getBoundingClientRect().height : null,
      tabContentDisplay: tabContent ? window.getComputedStyle(tabContent).display : null,
      tabContentAlign: tabContent ? window.getComputedStyle(tabContent).alignItems : null,
      tabContentJustify: tabContent ? window.getComputedStyle(tabContent).justifyContent : null,
      childHeight: child ? child.getBoundingClientRect().height : null,
      childTop: child ? child.getBoundingClientRect().top : null,
      tabContentTop: tabContent ? tabContent.getBoundingClientRect().top : null,
      childMarginTop: child ? window.getComputedStyle(child).marginTop : null,
      childClassList: child ? child.className : null
    };
  });
  console.log(JSON.stringify(info, null, 2));
  await browser.close();
})();
