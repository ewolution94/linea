<!--
  Share: the edit link and the view link with Copy (and Send where the device has a share sheet),
  making new links, and the downloads. On a view link only the view link and the downloads.
-->
<script lang="ts">
  import Icon from './Icon.svelte';
  import type { Board } from '../lib/board.svelte.ts';
  import type { View } from '../lib/view.svelte.ts';
  import { go } from '../lib/router.svelte.ts';
  import { savePng, saveJson } from '../lib/files.ts';
  import { t } from '../lib/i18n.svelte.ts';
  import { toast } from '../../vendor/ewo/elements/toaster.js';

  let { board, view }: { board: Board; view: View } = $props();

  let shown = $state(false);
  let confirming = $state(false);
  let copied = $state<'e' | 'v' | null>(null);
  let busy = $state(false);
  $effect(() => {
    if (view.sheet === 'share') shown = true;
  });

  const canSend = typeof navigator.share === 'function' && matchMedia('(hover: none)').matches;
  const name = $derived(board.doc.name || t('board.untitled'));
  const links = $derived(
    [
      board.editKey ? { w: 'e' as const, label: t('share.edit'), note: t('share.editNote'), url: `${location.origin}/e/${board.editKey}` } : null,
      board.viewKey ? { w: 'v' as const, label: t('share.view'), note: t('share.viewNote'), url: `${location.origin}/v/${board.viewKey}` } : null,
    ].filter((l) => !!l),
  );

  let copiedTimer: ReturnType<typeof setTimeout> | undefined;
  async function copy(w: 'e' | 'v', url: string) {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Older browsers: select the link so a long press or ⌘C copies it.
      const code = document.querySelector<HTMLElement>(`[data-link="${w}"]`);
      if (code) getSelection()?.selectAllChildren(code);
      return;
    }
    copied = w;
    clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => (copied = null), 1600);
  }

  async function send(url: string) {
    try {
      await navigator.share({ title: name, url });
    } catch {}
  }

  async function rekey() {
    busy = true;
    const keys = await board.rekey();
    busy = false;
    confirming = false;
    if (!keys) {
      toast(t('home.failed'), { tone: 'bad' });
      return;
    }
    view.sheet = null;
    toast(t('share.made'), { tone: 'ok' });
    go(`/e/${keys.edit}`, { replace: true });
  }
</script>

<ewo-sheet open={view.sheet === 'share'} label={t('board.share')} oncancel={() => (view.sheet = null)} onclose={() => ((shown = false), (confirming = false))}>
  <span slot="heading" class="heading">{t('share.title', { name })}</span>
  {#if shown}
    <div class="body">
      {#each links as link (link.w)}
        <div class="row">
          <div class="what"><b>{link.label}</b><span>{link.note}</span></div>
          <div class="link">
            <code data-link={link.w}>{link.url.replace(/^https?:\/\//, '')}</code>
            {#if canSend}
              <button type="button" class="icon-btn" aria-label="{t('share.send')}: {link.label}" onclick={() => send(link.url)}><Icon name="send" size={17} /></button>
            {/if}
            <button type="button" class="cp" onclick={() => copy(link.w, link.url)}>{copied === link.w ? t('share.copied') : t('share.copy')}</button>
          </div>
        </div>
      {/each}
      {#if board.role === 'edit'}
        <p class="note">{t('share.note')}</p>
        {#if confirming}
          <div class="confirm" role="alert">
            <p>{t('share.confirm')}</p>
            <div class="buttons">
              <button type="button" class="pill" onclick={() => (confirming = false)}>{t('share.no')}</button>
              <button type="button" class="pill solid" disabled={busy || board.offline} onclick={rekey}>{t('share.yes')}</button>
            </div>
          </div>
        {:else}
          <button type="button" class="new" disabled={board.offline} onclick={() => (confirming = true)}><Icon name="refresh" size={15} />{t('share.newLinks')}<span>{t('share.newLinksNote')}</span></button>
        {/if}
      {/if}

      <div class="downloads">
        <span class="label">{t('share.download')}</span>
        <button type="button" class="dl" onclick={() => savePng(board.doc)}><Icon name="image" /><b>{t('share.png')}</b><span>PNG · {t('share.pngNote')}</span></button>
        <button type="button" class="dl" onclick={() => saveJson(board.doc)}><Icon name="file" /><b>{t('share.json')}</b><span>JSON · {t('share.jsonNote')}</span></button>
      </div>
    </div>
  {/if}
</ewo-sheet>

<style>
  .heading {
    font-weight: 800;
    font-size: 18px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .body {
    display: grid;
    gap: 16px;
    padding-bottom: 12px;
  }

  .row {
    display: grid;
    gap: 8px;
  }

  .what {
    display: flex;
    align-items: baseline;
    gap: 8px;
    flex-wrap: wrap;
  }

  .what b {
    font-size: 14px;
  }

  .what span {
    color: var(--ink2);
    font-size: 13px;
  }

  .link {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 5px 5px 14px;
    background: var(--ground);
    border-radius: 999px;
  }

  code {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font: 500 12.5px/1.2 var(--mono);
    user-select: all;
    -webkit-user-select: all;
  }

  .cp {
    height: 32px;
    min-width: 76px;
    padding: 0 14px;
    border-radius: 999px;
    background: var(--ink);
    color: var(--pop);
    font-weight: 700;
    font-size: 12.5px;
    flex: none;
  }

  .note {
    font-size: 13px;
    color: var(--ink2);
  }

  .new {
    justify-self: start;
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    font-weight: 700;
    text-align: left;
  }

  .new span {
    font-weight: 400;
    color: var(--ink2);
  }

  .confirm {
    display: grid;
    gap: 10px;
    padding: 14px;
    border-radius: 14px;
    background: var(--ground);
    font-size: 14px;
  }

  .buttons {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
    flex-wrap: wrap;
  }

  .downloads {
    display: grid;
    gap: 6px;
    padding-top: 12px;
    border-top: 1px solid var(--rule);
  }

  .dl {
    display: grid;
    grid-template-columns: auto auto 1fr;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    border-radius: 12px;
    text-align: left;
  }

  .dl b {
    font-size: 14px;
  }

  .dl span {
    color: var(--ink2);
    font-size: 13px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  @media (hover: hover) and (pointer: fine) {
    .dl:hover {
      background: var(--hov);
    }

    .new:hover {
      text-decoration: underline;
      text-underline-offset: 3px;
    }
  }
</style>
