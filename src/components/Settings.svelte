<!--
  Settings, the family's way (Folio's ewo-sheet, General first with ewo-settings-basics), then the
  name the others see and the week's first day; the keys on a computer; what's kept where.
-->
<script lang="ts">
  import { ui, prefs, setName, type Language, type WeekStart } from '../lib/prefs.svelte.ts';
  import { theme, type ThemePreference } from '../lib/theme.svelte.ts';
  import { setLanguage, t } from '../lib/i18n.svelte.ts';

  const touchOnly = matchMedia('(hover: none)').matches;
  const mac = /Mac|iPhone|iPad/.test(navigator.platform);
  const cmd = mac ? '⌘' : 'Ctrl';

  let shown = $state(false);
  $effect(() => {
    if (ui.settings) shown = true;
  });

  const weeks: { value: WeekStart; label: () => string }[] = [
    { value: 'auto', label: () => t('settings.followsDevice') },
    { value: 'monday', label: () => t('settings.monday') },
    { value: 'sunday', label: () => t('settings.sunday') },
  ];
</script>

<ewo-sheet open={ui.settings} label={t('settings.title')} oncancel={() => (ui.settings = false)} onclose={() => ((shown = false), (ui.settings = false))}>
  <span slot="heading" class="heading"><b>{t('settings.title')}</b><span>{t('settings.line')}</span></span>
  {#if shown}
    <section>
      <h3 class="label">{t('settings.general')}</h3>
      <ewo-settings-basics
        language={prefs.language}
        theme={theme.preference}
        onlanguage-change={(e) => setLanguage(e.detail.value as Language)}
        ontheme-change={(e) => theme.set(e.detail.value as ThemePreference)}
      ></ewo-settings-basics>
    </section>

    <section>
      <h3 class="label">{t('settings.you')}</h3>
      <label class="set">
        <b>{t('people.name')}</b>
        <input class="field" value={prefs.name} maxlength="40" placeholder={t('people.namePh')} onchange={(e) => setName(e.currentTarget.value)} />
      </label>
      <div class="set">
        <b>{t('settings.week')}</b>
        <div class="seg" role="group" aria-label={t('settings.week')}>
          {#each weeks as w (w.value)}
            <button type="button" aria-pressed={prefs.week === w.value} onclick={() => (prefs.week = w.value)}>{w.label()}</button>
          {/each}
        </div>
      </div>
    </section>

    {#if !touchOnly}
      <section class="keys">
        <h3 class="label">{t('settings.keys')}</h3>
        <dl>
          <div><dt><kbd>←</kbd><kbd>→</kbd></dt><dd>{t('keys.move')}</dd></div>
          <div><dt><kbd>⌫</kbd></dt><dd>{t('keys.delete')}</dd></div>
          <div><dt><kbd>{cmd}</kbd><kbd>D</kbd></dt><dd>{t('keys.duplicate')}</dd></div>
          <div><dt><kbd>↵</kbd></dt><dd>{t('keys.rename')}</dd></div>
          <div><dt><kbd>{cmd}</kbd><kbd>Z</kbd></dt><dd>{t('keys.undo')}</dd></div>
          <div><dt><kbd>{cmd}</kbd><kbd>+</kbd><kbd>−</kbd></dt><dd>{t('keys.zoom')}</dd></div>
          <div><dt><kbd>Esc</kbd></dt><dd>{t('keys.deselect')}</dd></div>
          <div><dt><kbd>,</kbd></dt><dd>{t('keys.settings')}</dd></div>
        </dl>
      </section>
    {/if}

    <p class="privacy">{t('settings.privacy')}</p>
    <p class="privacy">{t('settings.fonts')}</p>
  {/if}
</ewo-sheet>

<style>
  .heading {
    display: grid;
  }

  .heading b {
    font-size: 24px;
    font-weight: 800;
    letter-spacing: -0.02em;
    line-height: 1;
  }

  .heading span {
    font-size: 12px;
    color: var(--ink2);
    margin-top: 4px;
    font-weight: 500;
  }

  section {
    display: grid;
    gap: 6px;
    padding-bottom: 16px;
  }

  h3 {
    margin-bottom: 2px;
  }

  .set {
    display: grid;
    gap: 8px;
    justify-items: start;
    padding: 10px 0;
    border-bottom: 1px solid var(--rule);
  }

  .set:last-child {
    border-bottom: 0;
  }

  .set b {
    font-size: 15px;
    font-weight: 600;
  }

  .set .field {
    max-width: 360px;
  }

  .seg {
    flex-wrap: wrap;
  }

  dl {
    display: grid;
    gap: 0.45rem;
    margin: 0;
    padding-top: 6px;
  }

  dl > div {
    display: grid;
    grid-template-columns: 6.5rem 1fr;
    align-items: center;
    gap: 0.75rem;
    font-size: 0.875rem;
  }

  dt {
    display: flex;
    gap: 0.2rem;
  }

  dd {
    margin: 0;
    color: var(--ink2);
  }

  kbd {
    display: inline-grid;
    place-items: center;
    min-width: 1.5rem;
    height: 1.5rem;
    padding: 0 0.3rem;
    border: 1px solid var(--rule);
    border-radius: 6px;
    font-family: var(--f);
    font-size: 0.75rem;
    font-weight: 600;
  }

  .privacy {
    font-size: 13px;
    color: var(--ink2);
    padding: 4px 0 8px;
  }
</style>
