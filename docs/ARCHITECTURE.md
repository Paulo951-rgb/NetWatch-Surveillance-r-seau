# Architecture de NetWatch

Document technique : découpage des modules, schéma de la base et contrat IPC.

## 1. Vue d'ensemble

```
┌────────────────────────────────────────────────────────────────┐
│ Renderer (React 19 + TypeScript)                               │
│  pages/ · components/ · hooks/ · i18n/ · styles/               │
└───────────────────────────┬────────────────────────────────────┘
                            │ window.netwatch (API typée, contextBridge)
┌───────────────────────────▼────────────────────────────────────┐
│ Preload (contextIsolation, sandbox)                            │
└───────────────────────────┬────────────────────────────────────┘
                            │ ipcRenderer.invoke / on
┌───────────────────────────▼────────────────────────────────────┐
│ Main (Electron) — ipc.ts valide chaque requête                 │
│  ├─ services/  scanner · traffic · connectivity · connections  │
│  │             diagnostics · network-info · oui · platform/*   │
│  ├─ alerts/engine.ts   règles, seuils, cooldown, notifications │
│  ├─ scheduler.ts       tâches périodiques verrouillées         │
│  ├─ data/              database · repositories · export        │
│  └─ settings/store.ts  validation, profils, persistance        │
└────────────────────────────────────────────────────────────────┘
```

Trois règles structurent le code :

1. **Aucune donnée inventée** : chaque valeur affichée provient d'un service qui lit le système ; les services
   renvoient explicitement `null`/vide quand la mesure est impossible, et l'interface affiche alors un état vide.
2. **Aucune confiance dans l'interface** : chaque handler IPC revalide ses entrées (types, bornes, noms d'hôtes).
   Les commandes système sont figées dans le code et exécutées via `execFile` (jamais de shell).
3. **Séparation des responsabilités** : collecte (services), persistance (dépôts), décision (moteur d'alertes),
   présentation (renderer). Aucun module du renderer n'accède au disque ni au réseau.

## 2. Cycle de vie

1. `app.whenReady()` → ouverture de la base (`data/database.ts`, WAL + migrations).
2. Création du contexte (`context.ts`) : services, dépôts, moteur d'alertes, planificateur.
3. Enregistrement des handlers IPC (`ipc.ts`) puis création de la fenêtre et de la zone de notification.
4. Le planificateur démarre les tâches périodiques selon les paramètres (trafic, latence, connexions, scan auto,
   purge). Les tâches sont verrouillées : une tâche lente ne peut pas se superposer à elle-même.
5. `before-quit` → arrêt des tâches, fermeture propre de SQLite.

## 3. Schéma de la base (SQLite, mode WAL)

| Table | Rôle |
| --- | --- |
| `devices` | Appareils connus : IP, MAC, fabricant, nom personnalisé, description, étiquettes, type, statut, approbation, première/dernière détection, ports ouverts |
| `device_presence` | Historique des changements d'état (en ligne / hors ligne) par appareil |
| `scans` | Un enregistrement par scan : plage, dates, durées, nombre d'hôtes |
| `scan_devices` | Association scan ↔ appareil (résultat de chaque scan) |
| `traffic_minutes` | Agrégats de trafic par minute et par interface (octets, débits) |
| `traffic_totals` | Compteurs cumulés par interface (base des deltas) |
| `alerts` | Alertes : type, priorité, titre, message, appareil, règle, acquittement |
| `events` | Journal général : catégorie, type, message, métadonnées JSON |
| `latency_samples` | Mesures de latence, gigue, perte, état Internet/passerelle/DNS |
| `diagnostics` | Rapports de diagnostic (résultats JSON, score) |
| `settings` | Paramètres et profils personnalisés (JSON) |

Index sur `devices(mac|ip|status)`, `alerts(created_at|read)`, `events(category, created_at)`,
`traffic_minutes(bucket)`, `latency_samples(ts)`, `device_presence(device_id, changed_at)`.

## 4. Contrat IPC

`src/shared/ipc.ts` définit les noms de canaux et les signatures. Le preload expose exactement ces méthodes.

| Domaine | Méthodes |
| --- | --- |
| Application | `getAppInfo`, `getSettings`, `updateSettings`, `resetSettings`, `listProfiles`, `saveProfile`, `applyProfile`, `deleteProfile`, `openLogs`, `openDataFolder`, `resetData`, `openExternal` |
| Réseau | `getNetworkInfo`, `getConnectivity`, `checkConnectivity`, `getTraffic`, `getTrafficSeries`, `getConnections`, `getTopProcesses` |
| Scanner | `startScan`, `cancelScan`, `getScanStatus`, `getScans`, `compareScans` |
| Appareils | `listDevices`, `getDevice`, `updateDevice`, `deleteDevice`, `approveDevice`, `getDevicePresence` |
| Alertes | `listAlerts`, `markAlertRead`, `markAllAlertsRead`, `clearAlerts`, `testNotification` |
| Historique | `queryHistory`, `getStats`, `exportData` |
| Diagnostic | `runDiagnostics`, `runDiagnosticTest`, `getLastDiagnostics`, `traceroute` |
| Événements temps réel | `live:network`, `live:traffic`, `live:connectivity`, `live:scan`, `live:alert`, `live:devices`, `live:connections`, `navigate` |

Chaque handler retourne une structure sérialisable ; les erreurs sont converties en messages courts et
journalisées côté processus principal (jamais de pile d'exécution exposée à l'interface).

### Contrôle d'origine

`src/main/security.ts` vérifie chaque appel avant d'exécuter le handler :

1. le cadre émetteur doit être le cadre **principal** (une iframe injectée est refusée) ;
2. `event.sender.id` doit correspondre à la fenêtre applicative ;
3. l'URL doit être `file://` (version empaquetée) ou le serveur Vite (développement).

Un refus écrit une ligne `IPC <canal> refusé : <raison>` dans le journal et renvoie une erreur générique.

`hardenSession()` complète la défense en profondeur : toutes les permissions de session sont refusées et
`webRequest.onBeforeRequest` annule toute requête du renderer vers un hôte non local (seuls `file://`,
`devtools://`, `blob:`, `data:` et le serveur de développement sont autorisés).

### Validation des entrées

`src/main/validation.ts` fournit `asString`, `asInt`, `asBool`, `asEnum`, `asHost`. Les cibles réseau (scan,
traceroute) passent par `asHost`, qui n'accepte qu'une IPv4 valide, un CIDR privé de préfixe 16–32 ou un nom
d'hôte court — jamais une chaîne contenant un séparateur de commande. Les identifiants, limites de pagination,
formats d'export et catégories sont bornés de la même manière.

## 5. Adaptateurs plateforme

`services/platform/{windows,linux,darwin}.ts` implémentent la même interface `PlatformAdapter` :

| Capacité | Windows | Linux | macOS |
| --- | --- | --- | --- |
| Route/passerelle | `route print` / `Get-NetRoute` | `/proc/net/route`, `ip route`, `route -n` | `route -n get default` |
| ARP | `arp -a` | `ip neigh`, `arp -an`, `/proc/net/arp` | `arp -an` |
| Connexions | `netstat -ano` + `tasklist` | `ss`, `netstat`, `/proc/net/*` + `/proc/<pid>/fd` | `lsof -i`, `netstat` |
| Compteurs | `Get-NetAdapterStatistics` | `/proc/net/dev` | `netstat -ib` |
| Ping | `ping -n` | `ping -c` (repli TCP si absent) | `ping -c` |
| Traceroute | `tracert -d` | `traceroute -n` | `traceroute -n` |

Les parseurs (`services/platform/parsers/*`) sont purs et testés sur des sorties réelles de chaque système.

## 6. Moteur d'alertes

`alerts/engine.ts` reçoit des faits (nouvel appareil, changement de connectivité, échantillon de trafic,
changement de configuration réseau, appareils hors ligne) et applique les règles des paramètres. Chaque règle
dispose d'un seuil et d'un délai de repos (`cooldownMinutes`) pour éviter le spam. Une alerte génère une ligne
`alerts`, un événement `events`, une notification système (si autorisée) et un message `live:alert`.

## 7. Performance et robustesse

* Collecte : échantillonnage à intervalle configurable (2 s par défaut pour le trafic), écriture agrégée par minute.
* Scanner : concurrence bornée, délais courts, arrêt possible, verrou empêchant deux scans simultanés.
* Réseau : chaque appel système a un délai maximal ; un échec est journalisé et renvoyé comme indisponible.
* Mémoire : séries limitées en RAM (historique glissant), données anciennes purgées selon la rétention.
* Interface : abonnements temps réel nettoyés au démontage des composants, aucun polling redondant.

### Résilience de la base

* Au démarrage, `PRAGMA quick_check` valide le fichier. Si la base est illisible, elle est renommée
  `netwatch.db.corrupt-<horodatage>` (avec ses fichiers `-wal`/`-shm`) et une base neuve est créée : l'application
  démarre toujours.
* `backupDatabase()` utilise l'API de sauvegarde à chaud de SQLite (cohérente en mode WAL).
* La restauration vérifie l'intégrité de la sauvegarde avant de remplacer le fichier, puis relance l'application.
* La fermeture (`before-quit`) exécute `context.close()` : arrêt des minuteurs, écriture des agrégats, fermeture
  de la base.

### Détection d'anomalie de trafic

`AlertEngine.onTraffic` conserve une fenêtre glissante de 120 échantillons (≈ 4 minutes à 2 s). Après 30
échantillons, un débit supérieur à `moyenne + max(3 σ, 2 × moyenne)` et à 4 Mbit/s déclenche une alerte
`traffic-anomaly` qui indique la moyenne mesurée et rappelle qu'un pic n'est pas une preuve d'attaque.
