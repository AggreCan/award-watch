"""Paths, hosts and identifiers shared by every stage."""

from __future__ import annotations

import os
from pathlib import Path

from . import __version__

# pipeline/awardwatch_pipeline/config.py -> repo root is two levels up from the package
REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = REPO_ROOT / "data"
RAW_DIR = DATA_DIR / "raw"
CACHE_DIR = RAW_DIR / "cache"
# Big files are streamed here, read once and deleted after the load.
WORK_DIR = RAW_DIR / "work"
# The 2026-10-31 downloads a dev run reads with --samples instead of fetching.
SAMPLES_DIR = RAW_DIR / "samples"
OUT_DIR = DATA_DIR / "out"
DEFAULT_DB = DATA_DIR / "awardwatch.sqlite"
SCHEMA_PATH = REPO_ROOT / "pipeline" / "schema.sql"
# The hosted search database (D1 awardwatch-search) has its own schema; see search_db.py.
SEARCH_SCHEMA_PATH = REPO_ROOT / "pipeline" / "search_schema.sql"
PACKAGE_DATA = Path(__file__).resolve().parent / "data"

# The contact in the user agent is a URL (the site's corrections form), so the
# project needs no mailbox; set both from the workflow's variables.
SITE_URL = os.environ.get("AWARDWATCH_SITE_URL", "https://awardwatch.example")
CONTACT = os.environ.get("AWARDWATCH_CONTACT", f"{SITE_URL}/corrections")
USER_AGENT = f"AwardWatch/{__version__} (+{SITE_URL}; {CONTACT})"

# Every source is a bulk file on an open-data host: one request per second per
# host, and no host has asked for more. A host that publishes a crawl delay
# goes here with it.
CRAWL_DELAY: dict[str, float] = {}
# Hosts where a refused or timed-out connection means the host has stopped
# taking requests from this address: each request is tried twice, and this
# many requests in a row failing that way end the run for the host (AbortRun)
# instead of retrying for twenty minutes.
CONNECT_FAIL_FAST: dict[str, int] = {}
DEFAULT_DELAY = 1.0

# open.canada.ca's CKAN action API.
CKAN_API = "https://open.canada.ca/data/api/action"
CKAN_PACKAGE_SHOW = CKAN_API + "/package_show?id={dataset}"
CKAN_ORGANIZATION_LIST = CKAN_API + "/organization_list"
# The member and dataset lists are not wanted; leaving them out keeps each
# answer to a few kilobytes.
CKAN_ORGANIZATION_SHOW = CKAN_API + "/organization_show?id={name}&include_datasets=false&include_users=false"

# CKAN dataset (and, for the single-file datasets, resource) ids.
TENDERS_DATASET = "6abd20d4-7a1c-4b38-baa2-9525d0bb2fd2"
AWARDS_DATASET = "a1acb126-9ce8-40a9-b889-5da2b1dd20cb"
HISTORY_DATASET = "4fe645a1-ffcd-40c1-9385-2c771be956a4"
CONTRACTS_DATASET = "d8f85d91-7dec-4fd1-8055-483b77225d8b"
CONTRACTS_RESOURCE = "fac950c0-00d5-4ec1-a4d3-9cbebf98a305"
GRANTS_DATASET = "432527ab-7aac-45b5-81d6-7597107a7013"
GRANTS_RESOURCE = "1d15a62f-5656-49ad-8c88-f40ce689d831"
LOBBYING_DATASET = "a34eb330-7136-4f5e-9f5f-3ba41df58b06"

# CanadaBuys files, as the three datasets' resources list them (2026-10-31).
# The fiscal-year files take the year as "2026-2027" (April to March); see
# canadabuys.fiscal_year.
CANADABUYS_BASE = "https://canadabuys.canada.ca/opendata/pub/"
TENDERS_NEW_FILE = "newTenderNotice-nouvelAvisAppelOffres.csv"
TENDERS_OPEN_FILE = "openTenderNotice-ouvertAvisAppelOffres.csv"
TENDERS_COMPLETE_FILE = "tenderNoticeComplete-avisAppelOffresComplet.csv"
# Listed for reference and not loaded: a legacy tender names no supplier.
TENDERS_LEGACY_FILE = "2009-2022-tenderNoticeHistorical-AvisAppelOffresHistorique.csv"
AWARDS_FY_FILE = "{fy}-awardNotice-avisAttribution.csv"
AWARDS_COMPLETE_FILE = "awardNoticeComplete-avisAttributionComplet.csv"
AWARDS_LEGACY_FILE = "2012-2022-awardNoticeHistorical-avisAttributionHistorique.csv"
HISTORY_FY_FILE = "{fy}-contractHistory-contratsOctroyes.csv"
HISTORY_COMPLETE_FILE = "contractHistoryComplete-contratsOctroyesComplet.csv"
HISTORY_LEGACY_FILE = "2009-2023-contractHistoryHistorical-contratsOctroyesHistorique.csv"

# The proactive publications, regenerated whole upstream every day.
CONTRACTS_URL = (
    f"https://open.canada.ca/data/dataset/{CONTRACTS_DATASET}/resource/{CONTRACTS_RESOURCE}/download/contracts.csv"
)
GRANTS_URL = f"https://open.canada.ca/data/dataset/{GRANTS_DATASET}/resource/{GRANTS_RESOURCE}/download/grants.csv"

# Registry of Lobbyists, monthly communication reports.
LOBBYING_URL = "https://lobbycanada.gc.ca/media/mqbbmaqk/communications_ocl_cal.zip"

ORGBOOK_SEARCH = "https://orgbook.gov.bc.ca/api/v4/search/topic"
