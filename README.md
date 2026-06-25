# 🚆 Delay Repay Sweeper

**Never miss out on train delay compensation again.**

If your UK train is delayed, the train company usually owes you money — this is called
**Delay Repay**. The problem is that nobody tells you when you're owed it, and claiming is a
faff. So most people never bother, and the train companies keep the money.

Delay Repay Sweeper is a small, free program that runs on **your own computer**. You tell it
which trains you take. It quietly watches those trains, checks how late they actually ran
against official railway data, and tells you the moment you're owed money — with a link straight
to the claim page (and, if you want, it fills most of the form in for you).

> **In one sentence:** it's a robot that watches your trains and tells you when the railway owes
> you a refund.

<img width="1438" height="719" alt="image" src="https://github.com/user-attachments/assets/d88fd46b-62c5-4c1e-ac92-f5f3975d2999" />

---

## Table of contents

1. [Is this safe? (Your privacy)](#-is-this-safe-your-privacy)
2. [What you'll need before you start](#-what-youll-need-before-you-start)
3. [Step-by-step setup (the slow, friendly version)](#-step-by-step-setup)
4. [The first-run setup wizard](#-the-first-run-setup-wizard)
5. [Using it day to day](#-using-it-day-to-day)
6. [Settings explained](#️-settings-explained)
7. [Stopping, starting, and updating](#-stopping-starting-and-updating)
8. [Troubleshooting](#-troubleshooting-common-problems)
9. [Frequently asked questions](#-frequently-asked-questions)
10. [For the curious: how it works](#-for-the-curious-how-it-works)
11. [Important disclaimers](#️-important-disclaimers)
12. [Licence & credits](#-licence--credits)

---

## 🔒 Is this safe? (Your privacy)

Yes — privacy is the whole point.

- **Everything stays on your computer.** There is no Delay Repay Sweeper "cloud", no account to
  sign up for with us, and no company (including us) that can see your data.
- The only places it ever connects to are: the **railway data service** (to check if trains were
  late) and, when *you* click to claim, the **train company's own website**.
- Your personal details (name, address, bank details for refunds) are saved in an **encrypted
  file** on your machine, locked with a key kept in your computer's own secure store (the Mac
  Keychain, Windows Credential Manager, or the Linux secret service).

In plain terms: it behaves like a private notebook on your desk, not like a website.

---

## 🧰 What you'll need before you start

- **A computer** running macOS, Windows, or Linux.
- About **15 minutes** for first-time setup.
- A **free account** with "Realtime Trains" (we'll walk you through getting it — it takes 2
  minutes and costs nothing).
- That's it. You do **not** need to connect your email, and you do **not** need to be technical.

> 💡 **Just want to look first?** You can run the app in **Demo Mode** with made-up sample journeys
> and skip everything below about accounts. See [Demo Mode](#demo-mode-try-before-you-set-anything-up).

---

## 🪜 Step-by-step setup

Don't worry if you've never used a "terminal" before — we'll explain each command.

### Step 1 — Install Node.js (the engine this app runs on)

This app is built on a free, widely-used tool called **Node.js**. You install it once.

1. Go to **<https://nodejs.org>**.
2. Download the version labelled **"LTS"** (it stands for "Long-Term Support" — the stable one).
3. Open the downloaded file and click through the installer like any other program.

> You need Node.js **version 20 or newer**. The LTS download will always be fine.

### Step 2 — Download Delay Repay Sweeper

**Option A — the easy way (no tools needed):**

1. Go to the project's GitHub page.
2. Click the green **`Code`** button → **`Download ZIP`**.
3. Unzip the downloaded file. You'll get a folder called `delay-repay-sweeper`.
4. Move that folder somewhere sensible, like your Documents folder.

**Option B — if you know how to use `git`:**

```bash
git clone https://github.com/ejwmcdonagh/delay-repay-sweeper.git
```

### Step 3 — Open a terminal *in that folder*

The "terminal" (or "command line") is just a window where you type commands.

- **On a Mac:** Open the **Terminal** app (press `Cmd + Space`, type "Terminal", hit Enter). Then
  type `cd ` (with a space after it), drag the `delay-repay-sweeper` folder onto the window, and
  press Enter.
- **On Windows:** Open the `delay-repay-sweeper` folder in File Explorer. Click the address bar at
  the top, type `cmd`, and press Enter. A black window opens, already in the right place.

> "`cd`" just means "go into this folder". The rest of the commands below should be typed into this
> same window.

### Step 4 — Install the app's building blocks

Type this and press Enter:

```bash
npm install
```

This downloads the small pieces the app needs. It may take a minute or two and print a lot of
text — that's normal. Wait until it finishes and you get your prompt back.

### Step 5 — Start it

Type:

```bash
npm start
```

You should see a line like:

```
Delay Repay Sweeper — dashboard at http://127.0.0.1:4505  (mode: notify)
```

🎉 It's running! **Leave this terminal window open** — closing it switches the app off.

### Step 6 — Open the dashboard

Open your web browser (Chrome, Safari, Edge, Firefox — any of them) and go to:

**<http://127.0.0.1:4505>**

> `127.0.0.1` always means "this computer". This page is served *only* to you, *only* on your
> machine — it is not on the internet.

The first time you open it, you'll be greeted by the **setup wizard**. On to that next.

---

## 🧙 The first-run setup wizard

The wizard has **three short steps**. It only appears until you've finished it.

### Step 1 of 3 — Connect train data

The app needs permission to look up real train times. This comes from a **free** service called
**Realtime Trains**. Here's how to get your key (called a "token"):

1. In a new browser tab, go to **<https://api-portal.rtt.io>**.
2. Sign up for a free account (it's for personal, non-commercial use, and is rate-limited but
   plenty for one person).
3. Once logged in, create an **app token**.
4. Copy that token, come back to the wizard, paste it into the box, and click **Save & continue**.

### Step 2 of 3 — Your journey & times

Tell it the trip you regularly make:

- **Home station** and **Destination station.** Start typing and a list will appear — **pick from
  the list** so the spelling is always correct. (We've bundled every UK National Rail station.)
- **Departure window** — the *range* of times you might catch your morning/outbound train (e.g.
  from `06:30` to `10:00`). You give a window, not one exact time, so it works even if you don't
  always catch the same train.
- **Return window** — the same idea for your trip home (e.g. `16:00` to `19:30`).

Click **Continue**.

### Step 3 of 3 — Which days do you travel?

Tick the days you actually make this journey (Monday–Friday is ticked for you by default). It won't
bother checking trains on the days you don't travel.

Click **Finish & start tracking**. The app immediately:

- starts watching your trains, **and**
- **looks back over the last 28 days** to find delays you may have already missed but can still
  claim for. (Delay Repay claims usually must be made within 28 days, so this is the sweet spot.)

You're done. The wizard won't show again.

---

## 📋 Using it day to day

Once set up, the dashboard shows a table of journeys it's found and watched. Just leave the app
running (see [keeping it running](#keeping-it-running-without-a-terminal-window)) and check the page
whenever you like.

### What the coloured labels mean

| Label | What it means |
|-------|---------------|
| **Pending Arrival** | It's watching this train; it hasn't arrived / been confirmed yet. |
| **On Time** | This train wasn't late enough to claim. Nothing to do. |
| **Eligible: 15+ min** 🟢 | **You're owed money!** This is the one that matters. |
| **Which train?** | Several trains in your window were late — click to tell it which one you actually took. |
| **Claimed** | You've submitted a claim for this one. |

The three boxes at the top give you a running total: how much you've reclaimed, how much is waiting
to be claimed, and how many journeys it checked this month.

### Making a claim

When a journey is **Eligible**, click **Claim now**. A window opens with:

- A button that opens the **correct train company's official claim page**.
- Depending on your chosen mode (below), either a **"copy" helper** that hands you each piece of
  information to paste into their form, or just the link for you to do it yourself.
- If anything is missing that their form needs (for example, a paper ticket's number, or your bank
  details for the refund), it asks you for it once and remembers it.

You always submit on the train company's own website — the app helps you get there with everything
ready.

---

## ⚙️ Settings explained

Click **Settings** (top right) to change any of these at any time.

### Operating modes — how much help do you want?

- **Notify only** — it just tells you you're owed money and links to the claim page. You do the
  rest. *(Simplest and safest.)*
- **Manual helper** — same, plus a handy panel that lets you copy each form field with one click.
- **Auto** — *(advanced, optional)* it tries to fill in and submit the claim for you automatically.
  See the [disclaimer](#️-important-disclaimers) before using this — it's experimental.

### Watched routes

This is where your journeys live. You can add more journeys (for example, a different commute or an
occasional trip) or remove old ones. Each is a station-to-station trip with a time window. There's
also a **"ask me which train I took"** option for season-ticket holders, for when several trains in
your window were delayed.

### Demo Mode (try before you set anything up)

Tick **Demo mode** to fill the app with realistic *made-up* journeys so you can explore every
feature without a Realtime Trains account or any real data. Untick it to go back to tracking your
real trains. (When demo mode is on, a "Demo" label shows at the top so you never confuse it with
the real thing.)

### Scan past days

How far back to look for delays (7–28 days). 28 is the default and usually the maximum the train
companies allow.

### Connecting your email inbox *(optional, advanced)*

**Most people should skip this and use Watched Routes instead** — it's simpler and needs no email
access. But if you'd like the app to read confirmation emails and pick up *one-off* trips
automatically, it can connect to Gmail or Microsoft 365. This is more fiddly to set up and is
explained inside Settings.

---

## 🔁 Stopping, starting, and updating

### Stopping it

Click on the terminal window and press **`Ctrl + C`** (hold Control, press C). Or just close the
window. The dashboard will stop loading — that's expected.

### Starting it again

Open a terminal in the `delay-repay-sweeper` folder (Step 3 above) and run `npm start` again. Your
settings and history are saved, so you carry on where you left off.

### Keeping it running without a terminal window

The app only watches trains while it's running. For day-to-day use you can simply start it in the
morning and stop it when done, or leave the terminal open in the background. (Setting it up to start
automatically when your computer boots is possible but is a more technical step, not covered here.)

### Updating to a newer version

If you downloaded a ZIP, download the new ZIP and replace the folder (your saved data lives
*outside* the app folder, so it's kept). If you used `git`, run `git pull`. Either way, run
`npm install` once afterwards in case the building blocks changed, then `npm start`.

> ⚠️ **After any update, always fully stop and restart the app** (`Ctrl + C`, then `npm start`).
> Refreshing the browser alone is not enough — the engine only picks up changes when restarted.

---

## 🆘 Troubleshooting (common problems)

**The dashboard page won't load / "can't connect".**
The app probably isn't running. Go to your terminal and run `npm start`. Make sure you're visiting
`http://127.0.0.1:4505`.

**The station suggestions don't appear when I type, or "Finish" seems to do nothing.**
You're almost certainly running an old copy of the engine after an update. **Stop the app
(`Ctrl + C`) and run `npm start` again**, then refresh the page. The app will now also pop up a
clear message if a request fails, instead of doing nothing.

**It says my Realtime Trains token failed.**
Double-check you copied the whole token with no extra spaces, and that you created an **app token**
at <https://api-portal.rtt.io>. You can paste a fresh one any time in **Settings → Train data**.

**"Port already in use" when starting.**
Another copy is probably already running. Either use that one, or start on a different port:
`DRS_PORT=4600 npm start`, then visit `http://127.0.0.1:4600`.

**My station isn't in the suggestion list.**
The list covers all National Rail stations. If you genuinely can't find yours, check the official
spelling — and note that some city names are listed in full (e.g. "Edinburgh" appears as "Edinburgh
Waverley").

**I closed the terminal and everything "disappeared".**
Nothing is lost — closing the terminal just switches the watcher off. Run `npm start` again and your
data and settings are all still there.

---

## ❓ Frequently asked questions

**Does this cost anything?**
No. The app is free and open-source, and the Realtime Trains data account is free too.

**Will it claim money automatically and put it in my account?**
By default, **no** — it tells you when you're owed and helps you claim, but *you* press the buttons
on the train company's site. There's an optional "Auto" mode that attempts the form for you, but
it's experimental (see disclaimers).

**Do I have to give it my bank details?**
Only if and when you make a claim that needs them (the refund has to go somewhere). They're stored
encrypted on your own computer and only used to fill the train company's claim form.

**Does it read my emails?**
Not unless you specifically set that up (it's optional and off by default). The normal way to use
the app — "watched routes" — needs no email access at all.

**Which train companies does it work with?**
Delay detection works for any National Rail journey. The claim step links you to the correct train
company's official Delay Repay page.

**Where is my data kept?**
In a hidden, encrypted file in your home folder (`.delay-repay-sweeper`), *not* inside the app
folder — which is why updating the app never wipes your history.

---

## 🔧 For the curious: how it works

You don't need this section to use the app — it's here if you're interested.

- It runs a tiny **background program (a "daemon")** on your computer that also serves the dashboard
  web page to your browser, all locally on `127.0.0.1`.
- Every few minutes it checks your watched train windows against **Realtime Trains** data, works out
  the delay, and applies the standard **Delay Repay** thresholds to decide what you're owed.
- It can optionally fall back to **National Rail's historical performance data** overnight to confirm
  delays the live check missed.
- Your settings, journeys, and claim details are saved in a single **AES-256 encrypted** file,
  unlocked by a key held in your operating system's secure store.

**For developers:** it's a Node.js + TypeScript project with a no-build, plain HTML/Tailwind
dashboard. The logic is test-driven (108 automated tests — run `npm test`). The codebase is laid out
in `lib/` (pure logic, fully tested), `ui/` (the dashboard), and `lib/daemon/` (the runner). See
[PLAN.md](./PLAN.md) for the design and the acceptance-test map.

---

## ⚠️ Important disclaimers

- This is an **independent, unofficial tool**. It is not affiliated with, endorsed by, or connected
  to any train company, National Rail, or Realtime Trains.
- **You are responsible for the claims you submit.** Only claim for journeys you actually made.
  Submitting false claims is fraud.
- The optional **"Auto" mode** that fills and submits claim forms for you is **experimental and
  unverified against live train-company websites**. It may stop working if a site changes, and
  automated submission may be against some train companies' terms of use. The safe, recommended
  default is "Notify" or "Manual helper", where you stay in control.
- Always double-check the details before submitting any claim.

---

## 📄 Licence & credits

- **Licence:** MIT — see [LICENSE](./LICENSE). You're free to use, modify, and share it.
- **Station data:** the bundled list of UK stations is derived from the open
  [`davwheat/uk-railway-stations`](https://github.com/davwheat/uk-railway-stations) dataset, itself
  based on National Rail open data. Thanks to its maintainers.
- **Train times:** provided by [Realtime Trains](https://www.realtimetrains.co.uk/) via their public
  API — please respect their fair-use terms.

---

*Made for anyone who's ever stood on a cold platform watching the "delayed" board and thought "I
should really claim that".*
