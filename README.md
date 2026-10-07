# Ultimate Web Scraper

**A local, grounded RAG system with a web-reading spider.** Browse any website with the RAG Spider Chrome extension: a spider walks over the page, highlights every word it reads, and saves the page into your own PostgreSQL + pgvector database. Then ask questions in a ChatGPT-style chat. Answers come **only** from what you collected, with numbered citations; anything else is refused instead of guessed.

Everything runs on your machine: FastAPI, PostgreSQL with pgvector, and Ollama with Qwen3 models. No cloud API, no data leaves your computer.

![The RAG Spider reading a news article](docs/images/spider-reading.png)

---

## Contents

- [What it does](#what-it-does)
- [Screenshots](#screenshots)
- [How it works](#how-it-works)
- [Requirements](#requirements)
- [Quick start (Windows)](#quick-start-windows)
- [Restore the shared database (optional)](#restore-the-shared-database-optional)
- [Install the RAG Spider extension](#install-the-rag-spider-extension)
- [Using it](#using-it)
- [Configuration](#configuration)
- [API](#api)
- [Project structure](#project-structure)
- [Tests and evaluation](#tests-and-evaluation)
- [Backup and export the database](#backup-and-export-the-database)
- [Security and privacy](#security-and-privacy)
- [Known limitations](#known-limitations)
- [Linux and macOS](#linux-and-macos)
- [Data and copyright](#data-and-copyright)

---

## What it does

- **RAG Spider (Chrome extension)**: an animated spider with eight 3-segment legs follows your mouse on any website, reads the page in order and highlights each word, heading and image it reads.
  - Saves the **whole page** automatically: on news sites only the article, elsewhere the main content. Menus, headers, footers, ads, share buttons, hashtags and related-news blocks are skipped.
  - Reads and saves **popups and dialogs** as their own entries.
  - **Remembers** what it read: revisit a page and the highlights come back instantly; a page is **never saved twice**.
  - Works on **internal sites** too, because the browser sends the text it sees.
  - **Crawl whole site**: follows links on the same website (100 to 2000 pages), respects `robots.txt`, one page per second.
- **Grounded chat**: a ChatGPT/Claude-style UI with chat history, citations you can click, a **How to use** guide, light and dark mode, and a collapsible sidebar.
- **No hallucinated answers**: questions that your documents don't cover (world knowledge, "write a poem", prompt injection) get *"No answer in your documents"*.
- **Hybrid search**: pgvector cosine search plus keyword search on the rare words of the question, fused with reciprocal rank fusion.
- **Multilingual**: tested with Uzbek (Latin), Russian and English content and questions.
- **Data management**: page and chunk counts in the sidebar, one-click **Clean up all data** (type `DELETE` to confirm; the tables stay), plus database export and import scripts.

## Screenshots

| Grounded chat (light) | Grounded chat (dark) |
|---|---|
| ![Chat with cited answer and refused world question](docs/images/chat-light.png) | ![Chat in dark mode](docs/images/chat-dark.png) |

| Spider keeps reading while you scroll | Built-in How to use guide |
|---|---|
| ![Spider reading after scrolling](docs/images/spider-scrolling.png) | ![How to use page](docs/images/how-to-use.png) |

The chat screenshots show real answers from the app: a question answered from a saved kun.uz article with its source cited, and *"What is the capital of France?"* refused because no saved page covers it.

## How it works

```mermaid
flowchart LR
    subgraph Browser
        EXT["RAG Spider extension<br/>reads the page you see"]
        UI["Chat UI<br/>127.0.0.1:8000"]
    end
    subgraph Server["FastAPI app (app.py)"]
        SAVE["/api/ingest/page<br/>store page text"]
        CRAWL["Site crawler<br/>robots.txt, 1 page/s"]
        ASK["/api/ask<br/>retrieve, gate, generate, verify"]
    end
    DB[("PostgreSQL + pgvector<br/>documents, versions,<br/>chunks, embeddings")]
    OLL["Ollama<br/>qwen3-embedding:4b<br/>qwen3:8b"]

    EXT -- "page text" --> SAVE
    EXT -- "Crawl whole site" --> CRAWL
    CRAWL -- "fetch public pages" --> WEB(("Web"))
    SAVE --> DB
    CRAWL --> DB
    UI -- "question" --> ASK
    ASK <--> DB
    SAVE -. "embed chunks" .-> OLL
    ASK -. "embed query + answer" .-> OLL
```

**Saving a page:** the text is split into overlapping chunks (about 1800 tokens each), embedded with `qwen3-embedding:4b` and stored with full version history. A page whose text has not changed is not stored again.

**Answering a question:**

1. **Retrieve**: the question is embedded with the Qwen3 query instruction and searched in pgvector. Keyword search runs in parallel on the question's *rare* words (words in at most 5% of chunks, such as names); both rankings are fused. Only the newest version of each page is searched.
2. **Gate in code**: chunks below a similarity cutoff (0.50, or 0.35 if they contain a rare word from the question) are dropped. If nothing is left, the app refuses **without calling the model**. That is what stops world-knowledge questions.
3. **Generate**: `qwen3:8b` gets the evidence first, then the question, with a strict rule and an exact refusal sentence.
4. **Verify**: every paragraph of the answer must cite evidence that was actually sent and share words with it; otherwise the answer is replaced by the refusal.

The cutoffs were measured, not guessed: with `qwen3-embedding:4b` relevant questions scored at least 0.575 and off-topic ones at most 0.408 on the test data.

## Requirements

| Component | Version tested | Notes |
|---|---|---|
| Windows | 10 / 11 | Batch scripts are for Windows; see [Linux and macOS](#linux-and-macos) |
| Python | 3.11 | 3.11 or newer |
| PostgreSQL | 17.5 | 15 or newer should work |
| pgvector | 0.8.1 | Must be installed into your PostgreSQL ([install guide](https://github.com/pgvector/pgvector#installation)) |
| Ollama | current | [ollama.com](https://ollama.com) |
| Models | `qwen3:8b` (about 5.2 GB), `qwen3-embedding:4b` (about 2.5 GB) | A GPU is strongly recommended; tested on an RTX 5070 Ti 16 GB |
| Browser | Google Chrome | Edge and Brave also load unpacked extensions |

## Quick start (Windows)

**1. Get the code**

```bat
git clone https://github.com/Abulqosim0227/Ultimate-Web-Scraper.git
cd Ultimate-Web-Scraper
```

Or unzip the shared zip file and open the `rag_app` folder.

**2. Pull the models**

```bat
ollama pull qwen3:8b
ollama pull qwen3-embedding:4b
```

**3. Create the database** (pgvector must already be installed in PostgreSQL)

```bat
psql -U postgres -c "CREATE DATABASE ragdb;"
```

The tables and the `vector` extension are created automatically from `schema.sql` when the app starts.

**4. Configure**

```bat
copy .env.example .env
```

Open `.env` and set your PostgreSQL password in `DATABASE_URL`:

```
DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@localhost:5432/ragdb
```

**5. Install the Python packages** (creates `.venv`)

```bat
install.bat
```

**6. Start the app**

```bat
start.bat
```

Keep the window open. `run_everything.bat` does the same, but also starts Ollama if it is not running and opens the browser.

**7. Open the chat** at [http://127.0.0.1:8000](http://127.0.0.1:8000). Both dots at the bottom of the sidebar (PostgreSQL, Ollama) should be green.

**8. Install the extension** as described [below](#install-the-rag-spider-extension), turn it on, and open any page.

## Restore the shared database (optional)

The shared zip file contains `db/ragdb.dump`, a ready database with the collected pages. It is not in the GitHub repository; see [Data and copyright](#data-and-copyright).

1. Complete steps 2 to 4 of the quick start. Use `EMBED_MODEL=qwen3-embedding:4b`, because the saved vectors were made with that model.
2. If `pg_restore` is not on your `PATH`, point to your PostgreSQL `bin` folder:
   ```bat
   set PG_BIN=C:\Program Files\PostgreSQL\17\bin
   ```
3. Run the import and type `YES` when asked. This **replaces** the RAG tables in the database from your `.env`.
   ```bat
   db\import_db.bat
   ```
4. Start the app. The sidebar shows how many pages and chunks were restored.

## Install the RAG Spider extension

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose the `spider_extension` folder of this project.
4. Pin **RAG Spider** from the puzzle icon in the toolbar.
5. Click the icon. The badge shows **ON** and the spider appears on the page.

You do **not** need a Chrome Web Store developer account. After updating the extension files, click the reload arrow on its card in `chrome://extensions` and press F5 on open tabs.

The extension only talks to the local app at `http://127.0.0.1:8000`. Chrome lists it as able to "read and change data on all websites" because it draws the spider on every page; it only sends a page's text when it saves that page.

## Using it

The app has a built-in **How to use** page in the sidebar. In short:

| Task | How |
|---|---|
| Collect a page | Turn the spider on and open the page. Wait until the panel says *saved to your database* (or *already in your database*) before asking about it; a page that is still saving cannot be found yet. |
| Make the spider read | Move the mouse: it follows and highlights what it walks over. Stop moving: it reads the rest of the visible page by itself. Scroll: it reads the new text. |
| Collect a popup | Open it; it is read and saved as its own entry. |
| Crawl a whole public site | In the spider panel choose a limit and press **Crawl whole site**. **Stop** ends it. |
| Ask | Type in the chat. Click a citation number to see its source. Name the person, company or topic; ask in the language of the source for the most exact wording. Each question is answered on its own. |
| Hide the sidebar | Click the panel icon at the top left. |
| Delete everything collected | **Clean up all data** in the sidebar, then type `DELETE`. Chats in the browser and spider highlights are not affected. |

## Configuration

All settings live in `.env` (see `.env.example`).

| Variable | Default | Meaning |
|---|---|---|
| `DATABASE_URL` | (required) | PostgreSQL connection string |
| `OLLAMA_URL` | `http://127.0.0.1:11434` | Ollama server |
| `CHAT_MODEL` | `qwen3:8b` | Model that writes answers |
| `EMBED_MODEL` | `qwen3-embedding:4b` | Embedding model. If you change it, re-collect your data and re-check `MIN_SIMILARITY` |
| `EMBED_MAX_INPUT_TOKENS` | `8192` | Safety limit per chunk |
| `EMBED_NORMALIZE` | `true` | Recorded with the embedding model |
| `RETRIEVAL_TOP_K` | `12` | Candidates from vector and keyword search |
| `FINAL_CONTEXT_K` | `6` | Chunks considered for the answer |
| `MIN_SIMILARITY` | `0.5` | Cutoff below which evidence is never sent to the model |
| `KEYWORD_MIN_SIMILARITY` | `0.35` | Lower cutoff for chunks containing a rare word of the question |
| `KEYWORD_MAX_SHARE` | `0.05` | A word counts as rare if it is in at most this share of chunks |
| `RAG_TEMPERATURE` | `0` | Answer randomness |
| `HTTP_TIMEOUT_SECONDS` | `20` | Timeout for fetching pages and calling Ollama |
| `CRAWL_DELAY_SECONDS` | `1.0` | Pause between crawled pages |
| `MAX_RESPONSE_BYTES` | `10000000` | Largest page the crawler downloads |
| `USER_AGENT` | `RAGReference/1.0` | User agent for crawling and robots.txt |

## API

The app listens on `http://127.0.0.1:8000`. All POST endpoints take JSON.

| Method | Path | Body | Purpose |
|---|---|---|---|
| GET | `/` | | Chat UI |
| GET | `/api/health` | | PostgreSQL and Ollama status |
| POST | `/api/ask` | `{"question"}` | Grounded answer with sources |
| POST | `/api/ingest/page` | `{"url", "title", "text", "section"?}` | Save page text sent by the extension; `section` names a popup. Returns `duplicate` if already saved |
| POST | `/api/ingest` | `{"url", "skip_existing"?}` | Fetch and save one public URL on the server |
| POST | `/api/crawl/site` | `{"url", "limit"}` | Start a same-site crawl (limit 1 to 2000) |
| POST | `/api/crawl/stop` | `{}` | Stop the running crawl |
| GET | `/api/crawl/status` | | Crawl progress and recent pages |
| GET | `/api/data/stats` | | Number of pages and searchable chunks |
| POST | `/api/data/clear` | `{"confirm": "DELETE"}` | Delete all data; tables stay. Refused while a crawl runs |

## Project structure

```
.
├── app.py                 FastAPI app: extraction, chunking, storage, retrieval, answering, API
├── crawler.py             Same-site breadth-first crawler with robots.txt support
├── schema.sql             Tables and indexes (applied automatically at startup)
├── static/index.html      Chat UI (single file, no build step)
├── spider_extension/      Chrome extension (Manifest V3)
│   ├── manifest.json
│   ├── background.js      Talks to the local API, validates requests
│   ├── reader.js          Finds the readable content, popups, word positions and clean text
│   ├── spider.js          The spider: body, 8 three-segment legs, gait and drawing
│   ├── content.js         Reading, memory, saving, popups and the panel
│   └── icons/
├── db/
│   ├── export_db.bat      Dump the database to db/ragdb.dump
│   └── import_db.bat      Restore db/ragdb.dump
├── docs/images/           Screenshots for this README
├── test_app.py            Unit tests: chunking, grounding, search, endpoints
├── test_crawler.py        Unit tests: crawler
├── eval_rag.py            Live evaluation against your database and Ollama
├── install.bat            Create .venv and install requirements
├── start.bat              Start the app
├── run_everything.bat     Start Ollama if needed, open the browser, start the app
├── run_tests.bat          Run the unit tests
├── requirements.txt
└── .env.example
```

## Tests and evaluation

```bat
run_tests.bat
```

Runs 49 offline unit tests: chunk offsets and overlap, the similarity gate, citation checking, rare-word keyword search, browser saves and duplicates, the data clean-up endpoint, the crawler (robots.txt, limits, stop), and more. No database or Ollama is needed.

```bat
.venv\Scripts\python.exe eval_rag.py
```

Asks 23 questions against the live database and Ollama and checks answers and refusals. Its cases were written for the sample pages collected during development, so adapt them to your own data.

## Backup and export the database

```bat
db\export_db.bat
```

Writes `db/ragdb.dump` (PostgreSQL custom format) from the database in `.env`. Set `PG_BIN` first if `pg_dump` is not on your `PATH`. Restore it with `db\import_db.bat`.

## Security and privacy

- **Local only**: the server binds to `127.0.0.1`; there is no login, so do not expose it to a network.
- **Safe server-side fetching**: the crawler only fetches public addresses on ports 80 and 443. It refuses private, loopback and link-local IPs, URLs with credentials, redirects, unexpected content types and oversized responses.
- **No cross-site posting**: all write endpoints accept JSON only, so a website cannot silently post into the app.
- **The app never saves itself**: pages of the RAG app are excluded in the extension and rejected by the server.
- **Secrets stay out of git**: `.env` is ignored; only `.env.example` is committed.
- **Deleting data** requires typing `DELETE`, and is refused while a crawl runs.

## Known limitations

- Each chat question is answered on its own; follow-ups like "and his children?" need the subject repeated.
- The answer's **Sources** list shows all evidence sent to the model, including chunks the answer did not cite.
- Answers translated across languages (for example a Uzbek question about Russian pages) can paraphrase loosely; asking in the source language is the most precise.
- The spider highlights only what is on screen. The whole page is still saved as soon as you open it.
- The crawler cannot read pages behind a login; use the spider on those pages instead.
- Very large pages (around 75 chunks or more) can hit the 20 second embedding timeout.
- Old page versions are kept in the database (hidden from search); crawled pages also store their raw HTML.
- The cutoffs were calibrated on the development data; re-check them with `eval_rag.py` on a very different corpus or embedding model.

## Linux and macOS

The Python app and the extension are cross-platform; only the `.bat` helpers are Windows-specific.

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env              # then set DATABASE_URL
uvicorn app:app --host 127.0.0.1 --port 8000
python -m pytest -q test_app.py test_crawler.py

# Database export and import
pg_dump --dbname="$DATABASE_URL" --format=custom --no-owner --no-privileges --file=db/ragdb.dump
pg_restore --dbname="$DATABASE_URL" --no-owner --no-privileges --clean --if-exists db/ragdb.dump
```

## Data and copyright

The shared database dump contains pages collected from public websites (mainly kun.uz news articles and nihol.uz pages). That content belongs to its publishers. It is included in the shared zip for demonstration and research only, and is deliberately **not** in this repository. Collect your own data with the spider for anything else.

## Tech stack

Python, FastAPI, PostgreSQL, pgvector, Ollama, Qwen3 (`qwen3:8b`, `qwen3-embedding:4b`), trafilatura, BeautifulSoup, psycopg 3, vanilla JavaScript, Canvas 2D, Chrome Extension Manifest V3.
