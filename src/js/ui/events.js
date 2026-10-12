// One accordion section is expanded at a time, with keyboard support.
const sectionBlocks = document.querySelectorAll('.section-block');
const designSidebar = $('designSidebar');
const sidebarRail = document.querySelector('.sidebar-rail');
const sidebarSectionRail = $('sidebarSectionRail');
const sidebarToggleBtn = $('sidebarToggleBtn');
const sidebarActionsBtn = $('sidebarActionsBtn');
const narrowSidebar = window.matchMedia('(max-width: 800px)');
let sidebarPinned = false;
let sidebarActiveSection = null;
let sidebarDismissTimer;

/**
 * Synchronizes accordion visibility and removes collapsed controls from keyboard navigation.
 * @function setSectionExpanded
 * @param {HTMLElement} block - Accordion section.
 * @param {boolean} expanded - Whether the section is open.
 * @returns {void}
 */
function setSectionExpanded(block, expanded) {
  block.classList.toggle('collapsed', !expanded);
  block.querySelector('.section-header').setAttribute('aria-expanded', String(expanded));
  block.querySelector('.section-body').inert = !expanded;
}

/**
 * Opens an overlay section without resizing or hiding the map preview.
 * @function openSidebarOverlay
 * @param {HTMLElement|null} [block=null] - Section to reveal, or the current section.
 * @param {boolean} [pin=false] - Keep the overlay open until explicitly dismissed.
 * @returns {void}
 */
function openSidebarOverlay(block = null, pin = false) {
  if (!narrowSidebar.matches) return;
  clearTimeout(sidebarDismissTimer);
  sidebarPinned = pin || sidebarPinned;
  if (block) {
    sidebarActiveSection = block;
    sectionBlocks.forEach(section => setSectionExpanded(section, section === block));
  }
  document.body.classList.add('sidebar-expanded');
  sidebarToggleBtn.setAttribute('aria-expanded', 'true');
  sidebarToggleBtn.setAttribute('aria-label', 'Close design settings');
  sidebarActionsBtn.setAttribute('aria-expanded', String(!block));
  sidebarSectionRail.querySelectorAll('button').forEach((button, index) => {
    button.setAttribute('aria-expanded', String(sectionBlocks[index] === sidebarActiveSection));
  });
  block?.scrollIntoView({ block: 'nearest' });
}

/**
 * Dismisses the compact sidebar while retaining desktop accordion state.
 * @function closeSidebarOverlay
 * @param {boolean} [restoreFocus=false] - Return keyboard focus to the sidebar toggle.
 * @returns {void}
 */
function closeSidebarOverlay(restoreFocus = false) {
  clearTimeout(sidebarDismissTimer);
  const focusInside = narrowSidebar.matches && designSidebar.contains(document.activeElement);
  sidebarPinned = false;
  sidebarActiveSection = null;
  document.body.classList.remove('sidebar-expanded');
  sidebarToggleBtn.setAttribute('aria-label', 'Open design settings');
  sidebarRail.querySelectorAll('[aria-expanded]').forEach(button => button.setAttribute('aria-expanded', 'false'));
  if (restoreFocus || focusInside) sidebarToggleBtn.focus();
}

/**
 * Delays closing while the pointer travels from the icon rail into its overlay.
 * @function scheduleSidebarDismiss
 * @returns {void}
 */
function scheduleSidebarDismiss() {
  clearTimeout(sidebarDismissTimer);
  sidebarDismissTimer = setTimeout(() => {
    const engaged = [sidebarRail, designSidebar].some(element =>
      element.matches(':hover') || element.contains(document.activeElement));
    if (!sidebarPinned && !engaged) closeSidebarOverlay();
  }, 150);
}

sectionBlocks.forEach((block, index) => {
  const header = block.querySelector('.section-header');
  const body = block.querySelector('.section-body');
  const bodyId = body.id || `section-body-${index + 1}`;
  body.id = bodyId;
  header.id = header.id || `section-header-${index + 1}`;
  header.setAttribute('role', 'button');
  header.setAttribute('tabindex', '0');
  header.setAttribute('aria-controls', bodyId);
  header.setAttribute('aria-expanded', String(!block.classList.contains('collapsed')));
  body.inert = block.classList.contains('collapsed');
  const railButton = document.createElement('button');
  railButton.type = 'button';
  railButton.className = 'sidebar-rail-btn';
  const sectionName = header.textContent.trim().replace(/^\d+\.\s*/, '');
  railButton.title = sectionName;
  railButton.setAttribute('aria-label', sectionName);
  railButton.setAttribute('aria-controls', bodyId);
  railButton.setAttribute('aria-expanded', 'false');
  const icon = header.querySelector('.section-icon').cloneNode(true);
  icon.setAttribute('aria-hidden', 'true');
  railButton.append(icon);
  sidebarSectionRail.append(railButton);
  railButton.addEventListener('pointerenter', event => {
    if (event.pointerType === 'mouse' && !sidebarPinned) openSidebarOverlay(block);
  });
  railButton.addEventListener('focus', () => {
    if (!sidebarPinned) openSidebarOverlay(block);
  });
  railButton.addEventListener('click', () => {
    if (sidebarPinned && sidebarActiveSection === block) closeSidebarOverlay();
    else {
      sidebarPinned = false;
      openSidebarOverlay(block, true);
    }
  });
  /** Toggles the accordion while keeping the rail state synchronized. */
  const toggleSection = () => {
    const isCollapsed = block.classList.contains('collapsed');
    sectionBlocks.forEach(other => setSectionExpanded(other, other === block && isCollapsed));
    if (narrowSidebar.matches) {
      sidebarActiveSection = isCollapsed ? block : null;
      sidebarSectionRail.querySelectorAll('button').forEach((button, railIndex) =>
        button.setAttribute('aria-expanded', String(sectionBlocks[railIndex] === sidebarActiveSection)));
    }
  };
  header.addEventListener('click', toggleSection);
  header.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      toggleSection();
    }
  });
});

sidebarToggleBtn.addEventListener('click', () => {
  if (document.body.classList.contains('sidebar-expanded') && sidebarPinned) closeSidebarOverlay();
  else openSidebarOverlay(null, true);
});
sidebarActionsBtn.addEventListener('click', () => {
  openSidebarOverlay(null, true);
  $('saveProjectBtn').focus();
});
[sidebarRail, designSidebar].forEach(element => {
  element.addEventListener('pointerleave', scheduleSidebarDismiss);
  element.addEventListener('focusout', scheduleSidebarDismiss);
  element.addEventListener('pointerenter', () => clearTimeout(sidebarDismissTimer));
});
document.addEventListener('pointerdown', event => {
  if (!sidebarRail.contains(event.target) && !designSidebar.contains(event.target)) closeSidebarOverlay();
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && narrowSidebar.matches && document.body.classList.contains('sidebar-expanded') && !document.querySelector('dialog[open]')) {
    event.preventDefault();
    closeSidebarOverlay(true);
  }
});
narrowSidebar.addEventListener('change', () => closeSidebarOverlay());

/**
 * Keeps sharing available through clipboard copying when native sharing is unsupported.
 * @function configureShareFallback
 * @returns {void}
 */
function configureShareFallback() {
  if (sharingSupported || !shareBtn) return;
  shareBtn.hidden = false;
  if (!navigator.clipboard?.writeText) {
    shareBtn.disabled = true;
    shareBtn.title = 'Sharing unavailable: this browser cannot share or copy links';
    shareBtn.setAttribute('aria-label', 'Sharing unavailable');
    return;
  }
  shareBtn.title = 'Copy a link to the current map design';
  shareBtn.setAttribute('aria-label', 'Copy map design link');
  shareBtn.addEventListener('click', async () => {
    await CartivaOperations.run({
      area: 'sharing.copy',
      button: shareBtn,
      successStatus: 'Map design link copied.',
      successNotification: 'Map design link copied to clipboard.',
      errorPrefix: 'Could not copy map design link'
    }, async () => navigator.clipboard.writeText(window.location.href));
  });
}
configureShareFallback();

const fineTuningToggle = document.getElementById('fineTuningToggle');
const fineTuningControls = document.getElementById('fineTuningControls');
fineTuningToggle.addEventListener('click', () => {
  const showControls = fineTuningControls.hidden;
  fineTuningControls.hidden = !showControls;
  fineTuningToggle.setAttribute('aria-expanded', String(showControls));
  fineTuningToggle.title = showControls ? 'Hide layer fine-tuning' : 'Show layer fine-tuning';
});

$('aboutDescription').textContent = APP.DESCRIPTION;
$('aboutVersion').textContent = APP.VERSION;
$('aboutGithubLink').href = APP.GITHUBLINK;
$('aboutBtn').addEventListener('click', () => $('aboutDialog').showModal());
$('aboutCloseBtn').addEventListener('click', () => $('aboutDialog').close());
$('aboutDialog').addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    event.preventDefault();
    $('aboutDialog').close();
  }
});

/** Records committed control changes and command activations without logging file contents. */
function logInteraction(event) {
  if (!(event.target instanceof Element)) return;
  const element = event.target.closest('button, a, input, select, [role="button"]');
  if (!element || (event.type === 'click' && element.matches('input, select'))) return;
  if (event.type === 'keydown' && !['Enter', ' '].includes(event.key)) return;
  CartivaDiagnostics.record('ui.interaction', 'User activated a control.', {
    element: element.id || element.getAttribute('aria-label') || element.textContent.trim(),
    action: event.type,
    value: element.type === 'checkbox' ? element.checked : element.type === 'file' ? undefined : element.value,
    label: element.getAttribute('aria-label') || element.title || undefined
  });
}
document.addEventListener('click', logInteraction);
document.addEventListener('change', logInteraction);
document.addEventListener('keydown', event => {
  if (event.target instanceof Element && event.target.matches('[role="button"]')) logInteraction(event);
});