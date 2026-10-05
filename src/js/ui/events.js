// One accordion section is expanded at a time, with keyboard support.
const sectionBlocks = document.querySelectorAll('.section-block');
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
  const toggleSection = () => {
    const isCollapsed = block.classList.contains('collapsed');
    sectionBlocks.forEach(other => {
      other.classList.add('collapsed');
      other.querySelector('.section-header').setAttribute('aria-expanded', 'false');
    });
    if (isCollapsed) {
      block.classList.remove('collapsed');
      header.setAttribute('aria-expanded', 'true');
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
  if (event.target.matches('[role="button"]')) logInteraction(event);
});