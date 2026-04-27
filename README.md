# Reddit Subreddit Blocker

A lightweight Tampermonkey userscript for hiding posts from specific subreddits on modern Reddit feeds.

It adds a small **Block** button beside subreddit names, keeps a local blocklist, and includes a simple manager UI for adding, removing, importing, and exporting blocked subreddits.

Built for:

* `www.reddit.com`
* `new.reddit.com`
* New Reddit / Shreddit layouts

Old Reddit is intentionally excluded.

---

## Features

* Hide posts from blocked subreddits across Reddit feeds
* Per-post **Block** button
* Floating blocklist counter button
* Blocklist manager UI
* Add or remove subreddits manually
* Import/export blocklists as JSON
* Optional confirmation before blocking
* Optional Reddit login nag hiding
* Optional fast CSS-based hiding
* SPA route-change rescanning for Reddit navigation
* Shreddit and shadow-root aware scanning
* Tampermonkey menu commands
* Dark-mode friendly UI

---

## Install

### 1. Install a userscript manager

Install one of these browser extensions:

* [Tampermonkey](https://www.tampermonkey.net/)
* [Violentmonkey](https://violentmonkey.github.io/)

Tampermonkey is the main tested target.

### 2. Install the script

Open the `fsm_reddit_subreddit_blocker.js` file in your browser, or create a new userscript in Tampermonkey and paste the script contents.

Recommended filename:

```text
fsm_reddit_subreddit_blocker.js
```

---

## Usage

Once installed, open Reddit and browse normally.

Each supported post should show a small **Block** button beside the subreddit name. Clicking it adds that subreddit to your local blocklist and hides matching posts.

A floating button in the bottom-right corner shows the current blocked subreddit count:

```text
Blocked: 12
```

Click that button to open the block manager.

---

## Block Manager

The manager lets you:

* Add a subreddit manually
* Remove individual subreddits
* Filter the blocked list
* Export your blocklist
* Import a blocklist
* Clear the full blocklist
* Toggle script settings

Accepted subreddit input formats:

```text
AskReddit
r/AskReddit
https://www.reddit.com/r/AskReddit/
```

All names are normalized internally, so `r/AskReddit` becomes:

```text
askreddit
```

---

## Import / Export Format

The export format is a simple JSON array:

```json
[
  "askreddit",
  "pics",
  "worldnews"
]
```

The importer also accepts:

```json
{
  "subreddits": ["askreddit", "pics", "worldnews"]
}
```

Or a comma/space-separated list:

```text
askreddit, pics, worldnews
```

---

## Tampermonkey Menu Commands

The script adds these commands to the Tampermonkey menu:

* **Open Blocked Subs Manager**
* **Block Current Subreddit**
* **Export Blocklist**
* **Force Rescan Now**
* **Toggle Login Nag Hiding**
* **Toggle Debug Logging**

---

## Settings

| Setting                 | Default | Description                                                                 |
| ----------------------- | ------: | --------------------------------------------------------------------------- |
| Hide Reddit login nags  |     Off | Attempts to hide Reddit login prompts and overlays.                         |
| Confirm before blocking |      On | Shows a confirmation before adding a subreddit to the blocklist.            |
| Show counter button     |      On | Shows the floating `Blocked: #` button.                                     |
| Animate feedback        |      On | Enables small UI animations and toast feedback.                             |
| Fast CSS hiding         |      On | Adds generated CSS selectors for faster hiding of known blocked subreddits. |
| Debug logging           |     Off | Logs script activity to the browser console.                                |

---

## Data Storage

The blocklist and settings are stored locally through the userscript manager using:

```javascript
GM_getValue
GM_setValue
```

No data is sent anywhere.

The script stores:

```text
tm.reddit.blockedSubs.v2
tm.reddit.blocker.settings.v1
```

---

## Browser Support

Tested target:

* Firefox or Chromium-based browsers
* Tampermonkey
* Reddit's modern web UI

Expected to work with:

* Violentmonkey
* Most modern desktop browsers

Not supported:

* Old Reddit
* Reddit mobile app
* Some mobile browser layouts

---

## Known Notes

Reddit changes its frontend often. This script uses multiple selectors and a mutation observer to keep working across New Reddit and Shreddit, but occasional layout changes may require selector updates.

The login nag hiding option is best-effort. Reddit may rename or restructure those elements at any time.

---

## Troubleshooting

### Posts are not hiding

Try the Tampermonkey menu command:

```text
Force Rescan Now
```

Then refresh Reddit.

### The Block button is not appearing

Open the manager and confirm the script is enabled. Reddit may have changed its markup on that page.

### Need console logs

Enable **Debug logging** in the manager or through the Tampermonkey menu, then open DevTools and filter the console by:

```text
[RedditBlocker]
```

## Disclaimer

This is an unofficial Reddit userscript. It is not affiliated with Reddit, Inc.
