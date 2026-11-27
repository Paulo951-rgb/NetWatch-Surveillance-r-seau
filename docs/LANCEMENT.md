# Lancer NetWatch — guide pas à pas

Trois façons de démarrer le logiciel, de la plus simple à la plus technique.
Choisissez celle qui correspond à votre situation.

---

## 1. Windows — avec l'installateur (recommandé)

Fichier : `release/NetWatch-1.0.0-setup.exe`

1. Double-cliquez sur `NetWatch-1.0.0-setup.exe`.
2. Windows affiche « Windows a protégé votre PC » (SmartScreen) car le binaire n'est pas signé :
   cliquez sur **Informations complémentaires**, puis **Exécuter quand même**.
3. Choisissez le dossier d'installation (ou gardez celui proposé), puis **Installer**.
4. À la fin, laissez cochée l'option de lancement, ou ouvrez **NetWatch** depuis le raccourci du
   Bureau ou du Menu Démarrer.
5. La fenêtre s'ouvre sur le **Tableau de bord**.

Ce que fait l'installateur : copie l'application dans `%LOCALAPPDATA%\Programs\NetWatch`,
crée les raccourcis, enregistre un désinstalleur. Aucun runtime à installer (Node.js et Electron
sont embarqués).

**Désinstaller** : Paramètres Windows → Applications → NetWatch → Désinstaller.
Les données (`%APPDATA%\NetWatch`) sont conservées ; supprimez ce dossier pour repartir de zéro.

---

## 2. Windows — version portable (aucune installation)

Fichier : `release/NetWatch-1.0.0-portable.exe`

1. Double-cliquez sur le fichier (même avertissement SmartScreen, même procédure).
2. L'application démarre directement, sans écrire dans `Programs`.
3. Les données restent dans `%APPDATA%\NetWatch\netwatch.db`.
4. Pour « désinstaller » : supprimez le fichier `.exe` et, si vous le souhaitez, le dossier de données.

Utile sur une clé USB ou sur un poste où vous n'avez pas les droits d'installation.

---

## 3. Linux — paquet autonome

Fichier : `release/NetWatch-1.0.0-x86_64.AppImage`

```bash
chmod +x NetWatch-1.0.0-x86_64.AppImage
./NetWatch-1.0.0-x86_64.AppImage
```

Si le lancement échoue :

```bash
# FUSE absent (Ubuntu 22.04+)
sudo apt install libfuse2

# Erreur de sandbox (certaines distributions)
./NetWatch-1.0.0-x86_64.AppImage --no-sandbox
```

Les données vont dans `~/.config/NetWatch/`.

---

## 4. Depuis le code source (Windows, Linux, macOS)

Prérequis : **Node.js 20 ou plus** (`node -v`) et **git**.

```bash
git clone https://github.com/Paulo951-rgb/NetWatch-Surveillance-r-seau.git
cd NetWatch-Surveillance-r-seau
git checkout netwatch-1.0.0
npm install
npm run dev
```

`npm run dev` ouvre l'application avec rechargement à chaud : modifiez un fichier de
`src/renderer`, la fenêtre se met à jour.

Version compilée (plus rapide, proche de la version distribuée) :

```bash
npm run build
npm start
```

Vérifier que tout est sain :

```bash
npm test           # 123 tests
npm run typecheck  # TypeScript strict
```

---

## 5. Reconstruire les fichiers `.exe`

### Recommandé : compiler sous Windows

Sur une machine Windows avec Node.js 20+ :

```bash
npm install
npm run dist:win
```

Résultat dans `release/` :

* `NetWatch-1.0.0-setup.exe` — installateur
* `NetWatch-1.0.0-portable.exe` — version portable

### Compilation croisée depuis Linux

```bash
npm run dist:win    # nécessite wine pour l'icône et les métadonnées de l'exécutable
npm run dist:linux  # AppImage
```

Une compilation native sous Windows reste préférable : elle évite toute dépendance à wine et
produit exactement ce que verront les utilisateurs.

---

## 6. Première utilisation — dans l'ordre

1. **Tableau de bord** : vérifiez l'adresse IP locale, la passerelle et les DNS. Le débit se met à
   jour toutes les 2 secondes, la latence toutes les 15 secondes.
2. **Scanner réseau** :
   * laissez la plage sur `auto` (NetWatch déduit le sous-réseau de votre interface) ou saisissez
     par exemple `192.168.1.0/24` ;
   * cliquez sur **Lancer le scan** ;
   * la barre de progression affiche les hôtes testés, puis les cartes se remplissent
     (appareils trouvés, nouveaux, hors ligne, durée).
3. **Appareils** : les machines inconnues portent le badge **Nouveau**. Ouvrez une fiche pour
   ajouter un nom, une description, des étiquettes, puis **Approuver** l'appareil.
4. **Alertes** : activez/désactivez les règles et ajustez les seuils (latence, débit, appareil
   hors ligne, délai de repos).
5. **Paramètres** :
   * *Surveillance* : fréquences de mesure ;
   * *Scans* : intervalle du scan automatique (15 min par défaut) ;
   * *Apparence* : thème sombre ou clair ;
   * *Démarrage* : lancer avec Windows, démarrer réduit.
6. **Diagnostic** : bouton **Lancer le diagnostic** pour tester Internet, latence, DNS, passerelle,
   traceroute et interfaces, avec une explication en français pour chaque anomalie.
7. **Historique** : filtrez par date et exportez en CSV ou JSON.

---

## 7. Si quelque chose ne va pas

| Symptôme | Cause | Solution |
| --- | --- | --- |
| « Impossible de déterminer automatiquement le réseau local » | interface sans sous-réseau IPv4 (VPN, lien /32) | saisir une plage manuellement dans le scanner |
| Aucun appareil trouvé | réseau isolé (Wi-Fi invité), ICMP filtré, mauvaise plage | vérifier la plage, relancer, lire la page Diagnostic |
| Latence « — » | ICMP bloqué par le réseau | la page Diagnostic indique la méthode réellement utilisée |
| La fenêtre ne s'affiche pas | démarrage réduit activé | cliquer sur l'icône NetWatch dans la zone de notification |
| SmartScreen bloque | binaire non signé | Informations complémentaires → Exécuter quand même |
| Connexions vides | droits insuffisants sur les processus d'autres utilisateurs | lancer avec des droits adaptés |

Journaux et base : boutons **Ouvrir les journaux** / **Ouvrir le dossier de données** dans
Paramètres → À propos.
