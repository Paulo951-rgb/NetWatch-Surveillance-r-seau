# Notes pour les agents (NetWatch)

## Commandes

```bash
npm run dev            # electron-vite dev (rechargement à chaud)
npm run build          # compilation main + preload + renderer dans out/
npm run typecheck      # tsc strict sur tsconfig.node.json et tsconfig.web.json
npm test               # Vitest (123 tests : unitaires + intégration système réelle)
npm run icons          # régénère build/icon.png|ico et build/tray.png (sans dépendance externe)
npm run oui            # reconstruit resources/oui.json depuis les registres IEEE
npm run dist:win       # installateur NSIS + portable (electron-builder)
npm run dist:linux     # AppImage
```

## Règles du projet

* **Aucune donnée simulée.** Les services renvoient `null`/vide quand la mesure est impossible ; l'interface
  affiche un état vide explicite. Ne jamais introduire de valeur de démonstration dans le code de production.
* **Aucune commande shell.** Les appels système passent par `execFile` (`src/main/services/platform/exec.ts`)
  avec des arguments séparés ; valider toute entrée avant exécution (`isSafeHost`, `clampInt`).
* **IPC validé.** Chaque handler de `src/main/ipc.ts` revalide ses entrées et renvoie des erreurs courtes.
  Ajouter un canal = mettre à jour `src/shared/ipc.ts` + `src/preload/index.ts` + `src/renderer/src/types`
  (déclaration `window.netwatch`).
* **i18n typée.** Toute nouvelle clé doit être ajoutée dans `fr.ts` **et** `en.ts` (les types imposent la parité).
* **Thèmes.** Utiliser les variables CSS de `styles/tokens.css` (`--surface`, `--text`, `--accent`…) ; ne jamais
  coder une couleur en dur dans un composant.

## Points d'architecture utiles

* `src/main/context.ts` assemble base SQLite, dépôts, services, moteur d'alertes et planificateur.
* `src/main/scheduler.ts` : tâches périodiques verrouillées (trafic, latence, connexions, scan auto, purge).
* `src/main/services/platform/*` : adaptateurs Windows/Linux/macOS ; parseurs purs dans `parsers/`.
  Sur Linux, `getConnections` retombe sur `/proc/net/*` et `ping` sur une mesure TCP si le binaire est absent.
* `resources/oui.json` : base fabricants (40 562 préfixes). En production elle est lue depuis
  `process.resourcesPath` (`resolveResourceDir()` dans `src/main/index.ts`).
* `better-sqlite3` 13 est en N-API : les binaires de toutes les plateformes sont dans le paquet npm, donc
  `npmRebuild: false` dans `electron-builder.yml` et le packaging croisé fonctionne.

## Vérification visuelle (sans écran)

```bash
NETWATCH_CAPTURE=/tmp/ui.png NETWATCH_CAPTURE_ROUTES="/dashboard,/traffic" \
NETWATCH_CAPTURE_DELAY=7000 npx electron --no-sandbox --ozone-platform=headless out/main/index.js
```

`NETWATCH_CAPTURE*` est un crochet de développement : l'application capture les pages puis quitte.

## Pièges connus

* Un environnement sans `DISPLAY` ne peut pas créer de zone de notification (le code l'ignore proprement).
* Les hôtes qui filtrent l'ICMP ne sont détectés que par ARP ou par test de ports.
* `guessScanRange` renvoie `null` pour un masque /31 ou /32 : le scan automatique est alors ignoré, et
  l'utilisateur doit saisir une plage.
