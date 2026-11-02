<!--
  A lane: its name, its colour, its place (up and down, for the phone, where there's no grip), and
  delete, with a confirm in the sheet and undo after.
-->
<script lang="ts">
  import Icon from './Icon.svelte';
  import { COLOURS, type Lane } from '../../shared/model.mjs';
  import type { Board } from '../lib/board.svelte.ts';
  import type { View } from '../lib/view.svelte.ts';
  import { t } from '../lib/i18n.svelte.ts';
  import { toast } from '../../vendor/ewo/elements/toaster.js';

  let { board, view }: { board: Board; view: View } = $props();

  let shown = $state<string | null>(null);
  let confirming = $state(false);
  $effect(() => {
    if (view.sheet === 'lane' && view.lane) shown = view.lane;
  });
  const found = $derived(board.doc.lanes.findIndex((l) => l.id === shown));
  // The last copy, so a deleted lane still fills the sheet while it slides out.
  let kept = $state<{ lane: Lane; index: number }>();
  $effect(() => {
    if (found >= 0) kept = { lane: board.doc.lanes[found], index: found };
    else if (shown && view.sheet === 'lane') view.sheet = null;
  });
  const index = $derived(found >= 0 ? found : shown && kept ? kept.index : -1);
  const lane = $derived(found >= 0 ? board.doc.lanes[found] : shown ? kept?.lane : undefined);
  const count = $derived(lane ? board.doc.items.filter((i) => i.lane === lane.id).length : 0);
  const open = $derived(view.sheet === 'lane' && !!lane && !board.readOnly);

  function close() {
    view.sheet = null;
  }

  function rename(value: string) {
    const name = value.replace(/\s+/g, ' ').trim();
    if (lane && found >= 0 && name && name !== lane.name) board.change([{ op: 'lane', id: lane.id, set: { name } }]);
  }

  function move(by: number) {
    if (!lane || found < 0) return;
    const ids = board.doc.lanes.map((l) => l.id);
    const to = index + by;
    if (to < 0 || to >= ids.length) return;
    ids.splice(index, 1);
    ids.splice(to, 0, lane.id);
    board.change([{ op: 'order', ids }]);
  }

  function remove() {
    if (!lane || found < 0) return;
    const name = lane.name;
    board.change([{ op: 'lane-', id: lane.id }]);
    close();
    toast(t('lane.deleted', { name }), { duration: 5000, action: { label: t('board.undo'), run: () => board.undo() } });
  }
</script>

<ewo-sheet {open} label={t('lane.menu')} oncancel={close} onclose={() => ((shown = null), (kept = undefined), (confirming = false))}>
  <span slot="heading" class="heading">{lane ? `M${index + 1}` : ''} {t('lane.menu')}</span>
  {#if lane}
    <div class="body">
      <input
        class="field name"
        value={lane.name}
        aria-label={t('board.laneName')}
        maxlength="120"
        spellcheck="false"
        onchange={(e) => rename(e.currentTarget.value)}
        onkeydown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      />
      <div class="fld">
        <span class="label">{t('lane.colour')}</span>
        <div class="swatches big">
          {#each { length: COLOURS } as _, c (c)}
            <button type="button" class="swatch c{c}" aria-label={t('tb.colour', { n: c + 1 })} aria-pressed={lane.colour === c} onclick={() => board.change([{ op: 'lane', id: lane.id, set: { colour: c } }])}></button>
          {/each}
        </div>
      </div>
      <div class="moves">
        <button type="button" class="pill" disabled={index === 0} onclick={() => move(-1)}><span class="up"><Icon name="left" size={16} /></span>{index > 0 ? `M${index}` : '–'}</button>
        <button type="button" class="pill" disabled={index === board.doc.lanes.length - 1} onclick={() => move(1)}><span class="down"><Icon name="left" size={16} /></span>{index < board.doc.lanes.length - 1 ? `M${index + 2}` : '–'}</button>
      </div>
      {#if confirming}
        <div class="confirm" role="alert">
          <p>{count ? t('lane.confirm', { n: count, name: lane.name }) : t('lane.confirmEmpty', { name: lane.name })}</p>
          <div class="row">
            <button type="button" class="pill" onclick={() => (confirming = false)}>{t('lane.no')}</button>
            <button type="button" class="pill danger" onclick={remove}>{t('lane.yes')}</button>
          </div>
        </div>
      {/if}
    </div>
  {/if}
  <div slot="footer" class="foot">
    {#if lane && !confirming}
      <button type="button" class="del" onclick={() => (confirming = true)}><Icon name="trash" size={16} />{t('lane.delete')}</button>
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
    font-size: 17px;
    font-weight: 700;
  }

  .fld {
    display: grid;
    gap: 6px;
  }

  .swatches.big .swatch {
    width: 32px;
    height: 32px;
  }

  .moves {
    display: flex;
    gap: 8px;
  }

  .up,
  .down {
    display: grid;
  }

  .up {
    rotate: 90deg;
  }

  .down {
    rotate: -90deg;
  }

  .confirm {
    display: grid;
    gap: 10px;
    padding: 14px;
    border-radius: 14px;
    background: var(--ground);
  }

  .row {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
  }

  .danger {
    background: var(--danger);
    color: #fff;
    box-shadow: none;
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
