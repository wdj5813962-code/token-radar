# Token Radar

[![make.fun](https://make.fun/badge?owner=wdj5813962-code&repo=token-radar&ref=vx2eyc9v)](https://make.fun/bounty/token-radar-01)

A token launch radar: it reads a sealed DefiLlama snapshot of 758 protocols, ranks the
pre-token ones by an implied value, and hands in a web dashboard with the board, a detail
view for every protocol and the steps to farm it.

## The model (radar-2)

Implied value follows only from the snapshot's own figures:

```
implied = round( tvl_usd x category_multiple
                 x (1 + clamp(change_7d, -60, 120) / 100 x 0.5)
                 x (0.6 + min(age_days, 1095) / 1095 x 0.4) )
```

The category multiple is the median market-cap / TVL of the snapshot's live-token
protocols in that category (15 categories have at least 3 comparables); a category with
fewer falls back to the overall median. A protocol is therefore valued at what the
market already pays for its own kind, not at one flat number. No protocol name is ever
special-cased: the same function scores every row.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

`main.ts` (Node 22, standard library only) reads the snapshot, writes the ranked board
to `out/board.json` (200 rows: the 40-protocol watchlist plus 160 early pre-token
protocols below the floor), writes the dashboard data to `out/data.js`, copies
`dashboard/` and `screenshots/` to `out/`, and writes `out/dossier.json`.

## The dashboard

`dashboard/` is a static page with no network: a sortable, filterable board, a detail
drawer per protocol (its model inputs and farm plan), and a live-token view set aside
with the market's own values. Open `out/dashboard/index.html` after a run.

## License

MIT
