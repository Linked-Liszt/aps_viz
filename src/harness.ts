/** Dev harness: /explainer.html?id=xpcs[&color=%23ff8800][&bl=xpcs] mounts one interactive station full-screen. */
import '@fontsource-variable/inter';
import '@fontsource/jetbrains-mono/400.css';
import './styles/main.css';
import { loadExplainer } from './ui/explainers/registry';

const q = new URLSearchParams(location.search);
const id = q.get('id') ?? 'xpcs';
const host = document.getElementById('host')!;
document.body.style.overflow = 'auto';
void loadExplainer(id).then((mod) => {
  if (!mod) {
    host.textContent = `Unknown station: ${id}.`;
    return;
  }
  document.getElementById('hh')!.textContent = `${mod.title}. ${mod.subtitle}`;
  const inst = mod.mount(host, { color: q.get('color') ?? '#5cd3ff', beamlineId: q.get('bl') ?? undefined });
  (window as unknown as { __station: unknown }).__station = inst;
});
