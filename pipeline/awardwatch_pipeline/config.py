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
# The operator's own copies of a source file, downloaded by hand under the
# publisher's licence for a host that refuses this project's requests. The
# nightly workflow fetches them from R2 (seeds/); a stage reads one only while
# its host refuses (sources/lobbying), and nothing writes here.
SEEDS_DIR = DATA_DIR / "seeds"
OUT_DIR = DATA_DIR / "out"
DEFAULT_DB = DATA_DIR / "awardwatch.sqlite"
SCHEMA_PATH = REPO_ROOT / "pipeline" / "schema.sql"
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
# The Internet Archive's captures of that file, read only while the registry's
# host refuses this project, and only those the archive already holds: its
# index for the newest capture that answered 200 (limit=-1 is the index's
# documented "last result"), then that capture's original bytes (id_). Nothing
# here asks the archive to fetch the registry.
LOBBYING_ARCHIVE_INDEX = ("https://web.archive.org/cdx/search/cdx?url=" + LOBBYING_URL.split("://", 1)[1]
                          + "&output=json&filter=statuscode:200&fl=timestamp,digest,length&limit=-1")
LOBBYING_ARCHIVE_CAPTURE = "https://web.archive.org/web/{timestamp}id_/" + LOBBYING_URL

ORGBOOK_SEARCH = "https://orgbook.gov.bc.ca/api/v4/search/topic"

# Standing offers and supply arrangements (sources/sosa.py): PSPC's weekly
# file of the active instruments and their holders, Open Government Licence.
SOSA_DATASET = "f5c8a5a0-354d-455a-99ab-8276aa38032e"
SOSA_URL = "https://sosa.canadabuys.canada.ca/cds/opendata/tpsgc-pwgsc_ocama-sosa.csv"
SOSA_DICTIONARY_URL = "https://donnees-data.tpsgc-pwgsc.gc.ca/ba2/ac-cb/ocama-sosa-dd.xml"
SOSA_SEARCH_URL = "https://sosa.canadabuys.canada.ca/"
# The host sends its own certificate without the intermediate that issued it
# (a Windows client fills the gap from its store; OpenSSL does not), so the
# verifying client fails on it. The operator places that intermediate's PEM
# here (docs/sosa.md); the stage then trusts it for this one host, with
# verification and the host name check still on.
SOSA_CA_PEM = PACKAGE_DATA / "sosa_intermediate.pem"
# A file whose rows fell by more than the hold rule allows is held for review;
# the operator releases it by writing its publication date (YYYY-MM-DD) here.
SOSA_RELEASE = PACKAGE_DATA / "sosa_release.txt"

# The Public Accounts of Canada (sources/public_accounts.py): PSPC's yearly
# files, Open Government Licence. Slice 1 reads the professional and special
# services; the works and the contractual obligations come with later slices.
PA_SERVICES_DATASET = "ac597ff8-ee13-48c3-b315-42e528090af2"
PA_WORKS_DATASET = "8776785b-445c-42bb-bb53-c29a1bff44dd"
PA_OBLIGATIONS_DATASET = "02986ea0-3ab7-4a13-b391-209e535726d9"
# A file held for review (too few rows, class blocks that do not add up) is
# applied once the operator writes its SHA-256, or its first 12 characters, here.
PA_RELEASE = PACKAGE_DATA / "public_accounts_release.txt"
# Payees withheld by hand: one hash of a normalized name per line
# (public_accounts.withhold_key), never a name, since the repository is public.
PA_WITHHOLD = PACKAGE_DATA / "public_accounts_withhold.txt"

# The organizations' spelling rule (merges.py, the fourth merge rule: one match
# key, any place). "on" merges the groups and still lists each one in
# data/out/review/organization-merges.txt, so the file stays the record of
# what merged; "shadow" lists them and merges nothing; "off" leaves the rule
# out. On since the operator's ruling of 2026-11-07, after the shadow nights;
# a reader flags a wrong merge from the profile, and a seed row with an empty
# to_norm keeps a pair apart.
ORG_SPELLING_MERGE = "on"
# The registry check of the review file (registry_review.py): at most this many
# OrgBook BC searches a night, the rest left to the cache and the nights after.
ORGBOOK_BUDGET = 200
ORGBOOK_TIMEOUT_S = 10.0
