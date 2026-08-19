"""Run every census metric of the atlas in one go.

    .venv/Scripts/python run_all_metrics.py [--write-r10] [--out DIR] [--only metric,...]

Population 2022 goes first (it defines the cell universe); the rest align
to it. A driver file rather than a shell script because the Windows shell
mangles the umlauts in the heating labels. Downloads: see README.md.
After it, pack the tiled LODs and rebuild the manifest:

    .venv/Scripts/python -m zensus_pipeline.pack --lod ../../apps/web/public/data/zensus/r9
    .venv/Scripts/python -m zensus_pipeline.pack --lod ../../apps/web/public/data/zensus/r10
    npm run build:manifest
"""

from __future__ import annotations

import argparse
import sys
import time

from zensus_pipeline.pipeline import main as pipeline_main

D = "downloads"
POP = f"{D}/Zensus2022_Bevoelkerungszahl_100m-Gitter.csv"
RENT = f"{D}/Durchschnittliche_Nettokaltmiete_und_Anzahl_der_Wohnungen/Zensus2022_Durchschn_Nettokaltmiete_Anzahl_der_Wohnungen_100m-Gitter.csv"
DOWNLOAD_DATE = "2026-08-18"

METRICS: dict[str, list[str]] = {
    "population_2022": [
        "--input", POP, "--metric", "population_2022", "--label", "Population 2022",
        "--source-url", "https://www.zensus2022.de/static/Zensus_Veroeffentlichung/Zensus2022_Bevoelkerungszahl.zip",
    ],
    "population_2011": [
        "--input", f"{D}/Zensus2011_Einwohnerzahl_100m_Gitter.csv",
        "--metric", "population_2011", "--label", "Population 2011", "--unit", "people",
        "--treat-missing", "-1",
        "--source-url", "https://www.zensus2011.de/SharedDocs/Downloads/DE/Pressemitteilung/DemografischeGrunddaten/csv_Bevoelkerung_100m_Gitter.zip",
    ],
    "age_mean": [
        "--input", f"{D}/Zensus2022_Durchschnittsalter_100m-Gitter.csv",
        "--rule", "wmean", "--value-column", "Durchschnittsalter",
        "--weight-input", POP, "--weight-value-column", "Einwohner",
        "--metric", "age_mean", "--label", "Average age", "--unit", "years",
        "--source-url", "https://www.destatis.de/static/DE/zensus/gitterdaten/Durchschnittsalter_in_Gitterzellen.zip",
    ],
    "homes": [
        "--input", RENT, "--rule", "sum", "--value-column", "AnzahlWohnungen",
        "--metric", "homes", "--label", "Homes", "--unit", "homes",
        "--source-url", "https://www.destatis.de/static/DE/zensus/gitterdaten/Durchschnittliche_Nettokaltmiete_und_Anzahl_der_Wohnungen.zip",
    ],
    "rent": [
        "--input", RENT, "--rule", "wmean", "--value-column", "durchschnMieteQM",
        "--weight-column", "AnzahlWohnungen",
        "--metric", "rent", "--label", "Net cold rent", "--unit", "€/m²",
        "--source-url", "https://www.destatis.de/static/DE/zensus/gitterdaten/Durchschnittliche_Nettokaltmiete_und_Anzahl_der_Wohnungen.zip",
    ],
    "heating": [
        "--input", f"{D}/Zensus2022_Energietraeger_100m-Gitter.csv",
        "--rule", "category", "--encoding", "cp1252",
        "--category-columns", "Gas,Heizoel,Fernwaerme,Solar_Geothermie_Waermepumpen,Strom,Holz_Holzpellets,Kohle",
        "--category-labels", "Gas,Heizöl,Fernwärme,Wärmepumpe,Strom,Biomasse,Kohle",
        "--metric", "heating", "--label", "Heating energy source",
        "--source-url", "https://www.destatis.de/static/DE/zensus/gitterdaten/Zensus2022_Energietraeger.zip",
    ],
    # published as a rate, so a dwelling-weighted mean, not a pooled share
    "vacancy_rate": [
        "--input", f"{D}/Zensus2022_Leerstandsquote_100m-Gitter.csv",
        "--rule", "wmean", "--value-column", "Leerstandsquote",
        "--weight-input", RENT, "--weight-value-column", "AnzahlWohnungen",
        "--metric", "vacancy_rate", "--label", "Vacancy rate", "--unit", "%",
        "--source-url", "https://www.destatis.de/static/DE/zensus/gitterdaten/Leerstandsquote_in_Gitterzellen.zip",
    ],
    "homes_new_share": [
        "--input", f"{D}/Zensus2022_Wohnungen_nach_Baujahresklassen_100m-Gitterzellen.csv",
        "--rule", "share", "--numerator-column", "a2014und_spaeter",
        "--denominator-column", "Insgesamt_Wohnungen",
        "--metric", "homes_new_share", "--label", "Built 2014 or later",
        "--source-url", "https://www.destatis.de/static/DE/zensus/gitterdaten/Wohnungen_nach_Baujahresklassen_in_Gitterzellen.zip",
    ],
    "household_size": [
        "--input", f"{D}/Zensus2022_Durchschn_Haushaltsgroesse_100m-Gitter.csv",
        "--rule", "wmean", "--value-column", "DurchschnHHGroesse",
        "--weight-input", POP, "--weight-value-column", "Einwohner",
        "--metric", "household_size", "--label", "Average household size", "--unit", "per home",
        "--source-url", "https://www.destatis.de/static/DE/zensus/gitterdaten/Durchschnittliche_Haushaltsgroesse_in_Gitterzellen.zip",
    ],
}


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out", default="../../apps/web/public/data/zensus")
    parser.add_argument("--write-r10", action="store_true")
    parser.add_argument("--only", help="comma-separated metric keys to run")
    args = parser.parse_args(argv)
    keys = args.only.split(",") if args.only else list(METRICS)
    for key in keys:
        if key not in METRICS:
            raise SystemExit(f"unknown metric {key}; known: {', '.join(METRICS)}")
        t0 = time.time()
        print(f"=== {key}", file=sys.stderr)
        extra = ["--download-date", DOWNLOAD_DATE, "--out", args.out]
        if args.write_r10:
            extra.append("--write-r10")
        pipeline_main(METRICS[key] + extra)
        print(f"=== {key}: {time.time() - t0:.0f} s", file=sys.stderr)


if __name__ == "__main__":
    main()
