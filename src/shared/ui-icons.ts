export type UiIconName = 'home' | 'settings' | 'close' | 'grid' | 'palette' | 'image' | 'external' | 'window' | 'edit' | 'trash' | 'sliders' | 'search' | 'upload' | 'refresh' | 'link' | 'save' | 'plus' | 'folderPlus' | 'copy' | 'scissors' | 'clipboard' | 'sort' | 'check' | 'chevronDown';

export function renderUiIcon(name: UiIconName): string {
  const paths: Record<UiIconName, string> = {
    home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5 10.5V20h14v-9.5"/>',
    settings: '<circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.86l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .92 1.7 1.7 0 0 1-3.08 0 1.7 1.7 0 0 0-1-.92 1.7 1.7 0 0 0-1.86.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.92-1 1.7 1.7 0 0 1 0-3.08 1.7 1.7 0 0 0 .92-1 1.7 1.7 0 0 0-.34-1.86l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.92 1.7 1.7 0 0 1 3.08 0 1.7 1.7 0 0 0 1 .92 1.7 1.7 0 0 0 1.86-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9c0 .38.14.74.4 1a1.7 1.7 0 0 1 0 2.4c-.26.26-.4.62-.4 1Z"/>',
    close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    grid: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
    palette: '<path d="M12 3c-5 0-9 3.58-9 8 0 3.54 2.61 6.53 6.28 7.58.92.26 1.72-.53 1.45-1.45-.2-.67.3-1.35 1-1.35H14a7 7 0 0 0 0-14Z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10.5" cy="7.5" r="1"/><circle cx="15" cy="8" r="1"/><circle cx="16.5" cy="12" r="1"/>',
    image: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.3"/><path d="m20.5 15-4.5-4.5L8 18.5"/>',
    external: '<path d="M14 5h5v5"/><path d="M10 14 19 5"/><path d="M19 14v5H5V5h5"/>',
    window: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="M3.5 9h17"/><path d="M8 3.5v3"/><path d="M16 3.5v3"/>',
    edit: '<path d="M4 20h4l10-10-4-4L4 16v4Z"/><path d="m13 7 4 4"/>',
    trash: '<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M7 7l1 13h8l1-13"/>',
    sliders: '<path d="M4 6h8"/><path d="M16 6h4"/><circle cx="14" cy="6" r="2"/><path d="M4 12h4"/><path d="M12 12h8"/><circle cx="10" cy="12" r="2"/><path d="M4 18h10"/><path d="M18 18h2"/><circle cx="16" cy="18" r="2"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/>',
    upload: '<path d="M12 16V5"/><path d="m7.5 9.5 4.5-4.5 4.5 4.5"/><path d="M5 19h14"/>',
    refresh: '<path d="M20 11a8 8 0 1 0 1 4"/><path d="M20 4v7h-7"/>',
    link: '<path d="M10 14 8 16a3 3 0 1 1-4-4l2-2a3 3 0 0 1 4 0"/><path d="m14 10 2-2a3 3 0 1 1 4 4l-2 2a3 3 0 0 1-4 0"/><path d="M9 15 15 9"/>',
    save: '<path d="M5 4h12l2 2v14H5Z"/><path d="M8 4v5h8V4"/><path d="M9 20v-6h6v6"/>',
    plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
    folderPlus: '<path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-9Z"/><path d="M15.5 13h5"/><path d="M18 10.5v5"/>',
    copy: '<rect x="8" y="8" width="10" height="12" rx="2"/><path d="M6 16H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1"/>',
    scissors: '<circle cx="6.5" cy="17.5" r="2.5"/><circle cx="6.5" cy="6.5" r="2.5"/><path d="M20 4 8.5 15.5"/><path d="m13 13 7 7"/>',
    clipboard: '<rect x="6" y="5" width="12" height="16" rx="2"/><path d="M9 5.5h6"/><path d="M9.5 3.5h5a1.5 1.5 0 0 1 1.5 1.5v1h-8v-1a1.5 1.5 0 0 1 1.5-1.5Z"/>',
    sort: '<path d="M4 6h16"/><path d="M4 11.5h10"/><path d="M4 17h5"/>',
    check: '<path d="M4 12 9 17 20 7"/>',
    chevronDown: '<path d="m6 9 6 6 6-6"/>',
  };

  return `<span class="ui-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths[name]}</svg></span>`;
}
