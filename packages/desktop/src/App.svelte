<script lang="ts">
  import "./styles/tokens.css";
  import { onMount } from "svelte";
  import { projects, loadProjects } from "./lib/stores";
  import Projects from "./screens/Projects.svelte";
  import Workspace from "./screens/Workspace.svelte";
  import AddProjectDialog from "./components/AddProjectDialog.svelte";
  import SetupWizard from "./screens/SetupWizard.svelte";
  import type { Project } from "./lib/types";

  let adding = $state(false);
  let opened = $state<Project | null>(null);
  let setupPath = $state<string | null>(null);

  onMount(async () => { await loadProjects(); });

  async function onsaved() { adding = false; await loadProjects(); }
  function onneedssetup(localPath: string) { adding = false; setupPath = localPath; }
</script>

<div data-testid="app-root" class="app">
  {#if opened}
    <Workspace project={opened} onback={() => (opened = null)} />
  {:else if setupPath}
    <SetupWizard localPath={setupPath} onfinish={async () => { setupPath = null; await loadProjects(); }} onback={() => (setupPath = null)} />
  {:else if adding}
    <AddProjectDialog {onsaved} {onneedssetup} oncancel={() => (adding = false)} />
  {:else}
    <Projects onopen={(p) => (opened = p)} onadd={() => (adding = true)} />
  {/if}
</div>

<style>.app { height: 100%; }</style>
