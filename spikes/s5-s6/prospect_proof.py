"""Spike S5/S6 proof: OSM rows and the seeded CSV list share one candidate shape; maps/review hosts are rejected.
Usage: python3 -I prospect_proof.py <osm_json> <seed_prospect_list_json> <out_csv>
"""
import csv, json, sys
from urllib.parse import urlparse

BLOCKED = ("google.", "goo.gl", "maps.app.goo.gl", "tripadvisor.", "yelp.", "foursquare.", "facebook.com/pages/reviews",
           "efood.gr", "wolt.com", "box.gr", "restaurantguru.", "citymaps.gr", "wanderlog.")
FIELDS = ["business_name", "vat_number", "website", "phone", "postal_code", "external_source", "external_ref"]
CHALANDRI = {"15231", "15232", "15233", "15234"}

def host_blocked(url):
    if not url:
        return False
    u = url if "://" in url else "https://" + url
    p = urlparse(u)
    full = (p.netloc + p.path).lower()
    return any(b in full for b in BLOCKED)

def osm_rows(path):
    for e in json.load(open(path))["elements"]:
        t = e.get("tags", {})
        if t.get("shop") not in ("bakery", "pastry") or not t.get("name"):
            continue
        web = t.get("website") or t.get("contact:website")
        pc = (t.get("addr:postcode") or "").replace(" ", "") or None
        yield {"business_name": t["name"], "vat_number": None, "website": None if host_blocked(web) else web,
               "phone": t.get("phone") or t.get("contact:phone"), "postal_code": pc,
               "external_source": "directory", "external_ref": f"{e['type']}/{e['id']}"}

def seed_rows(path):
    for r in json.load(open(path)):
        yield {k: r.get(k) for k in FIELDS}

def main(osm, seed, out):
    s = list(seed_rows(seed)); o = list(osm_rows(osm))
    assert all(r["business_name"] and r["postal_code"] in CHALANDRI for r in s), "seed row outside Chalandri"
    with open(out, "w", newline="") as f:
        w = csv.DictWriter(f, FIELDS); w.writeheader(); w.writerows(s + o)
    back = list(csv.DictReader(open(out)))
    print(f"seed_rows={len(s)} directory_osm_rows={len(o)} csv_rows={len(back)}")
    print("osm with postcode in 15231-15234:", sum(1 for r in o if r["postal_code"] in CHALANDRI))
    print("osm with website:", sum(1 for r in o if r["website"]))
    tests = ["https://www.google.com/maps/place/x", "maps.app.goo.gl/abc", "https://www.tripadvisor.com.gr/x",
             "https://box.gr/delivery/chalandri/x", "https://tassis.gr/", "https://breadbc.gr/"]
    for t in tests:
        print("blocked" if host_blocked(t) else "allowed", t)

if __name__ == "__main__":
    main(*sys.argv[1:4])
