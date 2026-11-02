<!--
  An item's details: its name, bar or milestone, its dates (a day at a time, or the date picker), its
  lane, its colour and a note. The phone opens it with a tap on an item; the desktop from the item's
  toolbar. On a view link it shows the same, to read.
-->
<script lang="ts">
  import Icon from './Icon.svelte';
  import { COLOURS, MAX_DAY, type Item } from '../../shared/model.mjs';
  import type { Board } from '../lib/board.svelte.ts';
  import type { View } from '../lib/view.svelte.ts';
  import { dateParts, fromIso, full, iso, short, withWeekday } from '../lib/dates.ts';
  import { t } from '../lib/i18n.svelte.ts';

  let { board, view, onremove }: { board: Board; view: View; onremove: (id: string) => void } = $props();

  // The content stays until the sheet's `close`, which fires after its exit animation.
  let shown = $state<string | null>(null);
  $effect(() => {
    if (view.sheet === 'item' && view.sel) shown = view.sel;
  });
  const live = $derived(shown ? board.doc.items.find((i) => i.id === shown) : undefined);
  // The last copy, so a deleted item still fills the sheet while it slides out.
  let kept = $state<Item>();
  $effect(() => {
    if (live) kept = live;
    // Deleted here or by someone else: the sheet goes.
    else if (shown && view.sheet === 'item') view.sheet = null;
  });
  const item = $derived(live ?? (shown ? kept : undefined));
  const ro = $derived(board.readOnly);
  const open = $derived(view.sheet === 'item' && !!item);
  const fields = $derived<('start' | 'end')[]>(item?.kind === 'ms' ? ['start'] : ['start', 'end']);
  const laneColour = $derived(board.doc.lanes.find((l) => l.id === item?.lane)?.colour ?? 0);

  function set(fields: Partial<Item>) {
    if (live) board.change([{ op: 'item', id: live.id, set: fields }]);
  }

  function step(field: 'start' | 'end', days: number) {
    if (!item) return;
    if (item.kind === 'ms') {
      const len = item.end - item.start;
      const start = Math.max(0, Math.min(MAX_DAY - len, item.start + days));
      set({ start, end: start + len });
    } else if (field === 'start') set({ start: Math.max(0, Math.min(item.end - 1, item.start + days)) });
    else set({ end: Math.max(item.start + 1, Math.min(MAX_DAY, item.end + days)) });
  }

  function pick(field: 'start' | 'end', value: string) {
    const day = fromIso(value);
    if (!item || day === null) return;
    if (item.kind === 'ms' || field === 'start') {
      const len = item.end - item.start;
      // A new start keeps the length when it would pass the end.
      if (item.kind === 'ms' || day >= item.end) set({ start: day, end: day + len });
      else set({ start: day });
    } else set({ end: Math.max(item.start + 1, day + 1) });
  }

  function commitName(value: string) {
    const name = value.replace(/\s+/g, ' ').trim();
    if (item && name !== item.name) set({ name });
  }

  function commitNote(value: string) {
    if (item && value !== item.note) set({ note: value });
  }

  function close() {
    view.sheet = null;
  }
</script>

<ewo-sheet class="item-sheet" {open} label={t('tb.item')} oncancel={close} onclose={() => ((shown = null), (kept = undefined))}>
  <span slot="heading" class="heading">{t('tb.item')}</span>
  {#if item}
    <div class="body">
      {#if ro}
        <h2 class="name">{item.name || t('item.untitled')}</h2>
      {:else}
        <input
          class="name field"
          value={item.name}
          placeholder={t('item.untitled')}
          aria-label={t('board.itemName')}
          maxlength="120"
          spellcheck="false"
          onchange={(e) => commitName(e.currentTarget.value)}
          onkeydown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
        <div class="seg kind" role="group" aria-label={t('sheet.kind')}>
          <button type="button" aria-pressed={item.kind !== 'ms'} onclick={() => set({ kind: 'bar' })}><Icon name="bar" size={15} />{t('sheet.bar')}</button>
          <button type="button" aria-pressed={item.kind === 'ms'} onclick={() => set({ kind: 'ms' })}><Icon name="station" size={15} />{t('sheet.milestone')}</button>
        </div>
      {/if}

      <div class="dates" class:one={item.kind === 'ms'}>
        {#each fields as field (field)}
          {@const label = item.kind === 'ms' ? t('sheet.date') : field === 'start' ? t('sheet.starts') : t('sheet.ends')}
          {@const day = field === 'start' ? item.start : item.end - 1}
          <div class="st">
            <span class="label">{label}</span>
            {#if ro}
              <b class="ro-date">{full(day)}</b>
            {:else}
              <div class="st-c">
                <button type="button" aria-label={t('sheet.earlier', { label })} onclick={() => step(field, -1)}><Icon name="left" /></button>
                <label class="pickday">
                  <b>{withWeekday(day)}</b>
                  <small>{dateParts(day).y}</small>
                  <input type="date" value={iso(day)} aria-label={label} onchange={(e) => pick(field, e.currentTarget.value)} />
                </label>
                <button type="button" aria-label={t('sheet.later', { label })} onclick={() => step(field, 1)}><Icon name="right" /></button>
              </div>
            {/if}
          </div>
        {/each}
      </div>
      {#if item.kind !== 'ms'}
        <p class="days">{short(item.start)} – {short(item.end - 1)} · {t('item.days', { n: item.end - item.start })}</p>
      {/if}

      {#if !ro}
        <div class="fld">
          <span class="label">{t('sheet.lane')}</span>
          <div class="chips">
            {#each board.doc.lanes as lane, i (lane.id)}
              <button type="button" class="chip c{lane.colour}" aria-pressed={lane.id === item.lane} onclick={() => set({ lane: lane.id })}><i></i>M{i + 1} {lane.name}</button>
            {/each}
          </div>
        </div>

        <div class="fld">
          <span class="label">{t('sheet.colour')}</span>
          <div class="swatches big">
            <button type="button" class="swatch lane c{laneColour}" aria-label={t('tb.laneColour')} aria-pressed={item.colour === null} onclick={() => set({ colour: null })}></button>
            {#each { length: COLOURS } as _, c (c)}
              <button type="button" class="swatch c{c}" aria-label={t('tb.colour', { n: c + 1 })} aria-pressed={item.colour === c} onclick={() => set({ colour: c })}></button>
            {/each}
          </div>
        </div>
      {/if}

      <div class="fld">
        <span class="label">{t('sheet.note')}</span>
        {#if ro}
          <p class="note">{item.note || '–'}</p>
        {:else}
          <textarea class="field note" rows="3" maxlength="2000" placeholder={t('sheet.notePh')} value={item.note} onchange={(e) => commitNote(e.currentTarget.value)}></textarea>
        {/if}
      </div>
    </div>
  {/if}
  <div slot="footer" class="foot">
    {#if !ro && item}
      <button type="button" class="del" onclick={() => (close(), onremove(item.id))}><Icon name="trash" size={16} />{t('sheet.delete')}</button>
    {/if}
    <button type="button" class="pill solid done" onclick={close}>{t('sheet.done')}</button>
  </div>
</ewo-sheet>

<style>
  .heading {
    font-weight: 800;
    font-size: 18px;
  }

  .body {
    display: grid;
    gap: 16px;
    padding-bottom: 8px;
  }

  .name {
    font-size: 18px;
    font-weight: 700;
  }

  .kind {
    display: flex;
  }

  .kind button {
    flex: 1 1 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 8px 12px;
    font-size: 13.5px;
  }

  .dates {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }

  .dates.one {
    grid-template-columns: 1fr;
  }

  .st,
  .fld {
    display: grid;
    gap: 6px;
    min-width: 0;
  }

  .st-c {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 44px;
    padding: 0 4px;
    border-radius: 999px;
    background: var(--ground);
  }

  .st-c button {
    width: 36px;
    height: 36px;
    display: grid;
    place-items: center;
    border-radius: 50%;
    flex: none;
  }

  /* The day over its year, so two dates fit side by side on a phone. */
  .pickday {
    position: relative;
    flex: 1 1 auto;
    min-width: 0;
    display: grid;
    justify-items: center;
    line-height: 1.15;
    cursor: pointer;
  }

  .pickday b {
    font-size: 13.5px;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .pickday small {
    font-size: 11px;
    color: var(--ink2);
    font-variant-numeric: tabular-nums;
  }

  /* The native picker under the date: a tap opens it. */
  .pickday input {
    position: absolute;
    inset: 0;
    width: 100%;
    opacity: 0;
    cursor: pointer;
  }

  .ro-date {
    font-size: 15px;
  }

  .days {
    margin-top: -8px;
    color: var(--ink2);
    font-size: 13px;
  }

  .chips {
    display: flex;
    gap: 6px;
    overflow-x: auto;
    scrollbar-width: none;
    margin-inline: -4px;
    padding: 2px 4px;
  }

  .chip {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 34px;
    padding: 0 12px 0 10px;
    border-radius: 999px;
    border: 1.5px solid var(--rule);
    font-weight: 600;
    font-size: 13px;
    white-space: nowrap;
  }

  .chip i {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--c);
  }

  .chip[aria-pressed='true'] {
    border-color: var(--ink);
    background: var(--ink);
    color: var(--pop);
  }

  .swatches.big .swatch {
    width: 32px;
    height: 32px;
  }

  .note {
    resize: vertical;
    min-height: 72px;
  }

  p.note {
    white-space: pre-wrap;
    color: var(--ink);
  }

  .foot {
    display: flex;
    justify-content: space-between;
    align-items: center;
    width: 100%;
  }

  .del {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--danger);
    font-weight: 600;
    height: 40px;
  }

  .done {
    height: 44px;
    margin-left: auto;
    padding: 0 26px;
    font-weight: 700;
  }
</style>
