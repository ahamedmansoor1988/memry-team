const SIDE_PANEL_OPTIONS = { openPanelOnActionClick: true };

async function enableSidePanel() {
  if (!chrome.sidePanel?.setPanelBehavior) return;
  try {
    await chrome.sidePanel.setPanelBehavior(SIDE_PANEL_OPTIONS);
  } catch (error) {
    console.warn("[Loupe] Could not enable side panel behavior", error);
  }
}

chrome.runtime.onInstalled.addListener(enableSidePanel);
chrome.runtime.onStartup?.addListener(enableSidePanel);

chrome.action.onClicked.addListener(async (tab) => {
  if (!chrome.sidePanel?.open || !tab?.windowId) return;
  try {
    await chrome.sidePanel.open({ windowId: tab.windowId });
  } catch (error) {
    console.warn("[Loupe] Could not open side panel", error);
  }
});

enableSidePanel();
