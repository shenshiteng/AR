# -*- coding: utf-8 -*-
"""把 data/floor-3f.js 画回平面图核对（全楼 + 右侧局部两张）"""
import cv2, io, re, json

D = json.loads(re.search(r"window\.FLOOR_DATA\s*=\s*(\{.*\})\s*;",
                         io.open("data/floor-3f.js", encoding="utf-8").read(), re.S).group(1))

img = cv2.imread("../assets/floors/B2-3F.jpg")
ov = img.copy()
COLOR = {"stair":(120,120,255),"toilet":(200,180,90),"lab":(90,190,90),
         "office":(230,150,70),"room":(80,170,240),"store":(180,120,200),
         "service":(150,150,150)}
for r in D["rooms"]:
    cv2.rectangle(ov, (r["x1"], r["y1"]), (r["x2"], r["y2"]), COLOR.get(r["kind"],(0,0,255)), -1)
vis = cv2.addWeighted(ov, 0.26, img, 0.74, 0)

for sp in D.get("spurs", []):
    cv2.rectangle(vis, (sp["x1"], sp["y1"]), (sp["x2"], sp["y2"]), (0, 230, 230), -1)
    cv2.rectangle(vis, (sp["x1"], sp["y1"]), (sp["x2"], sp["y2"]), (0, 150, 150), 2)

for r in D["rooms"]:
    cv2.rectangle(vis, (r["x1"], r["y1"]), (r["x2"], r["y2"]), (0,0,255), 1)
    t = r["id"] if len(r["id"]) <= 4 else r["id"][:4]
    cv2.putText(vis, t, (r["x1"]+2, r["y1"]+13), cv2.FONT_HERSHEY_SIMPLEX, 0.38, (0,0,255), 1)
    cx = (r["x1"]+r["x2"])/2.0; cy = (r["y1"]+r["y2"])/2.0
    if r.get("doorT") is not None:
        if r["door"] in ("N","S"): cx = r["x1"] + (r["x2"]-r["x1"])*r["doorT"]
        else: cy = r["y1"] + (r["y2"]-r["y1"])*r["doorT"]
    d = {"W":(r["x1"],cy),"E":(r["x2"],cy),"N":(cx,r["y1"]),"S":(cx,r["y2"])}[r.get("door","S")]
    cv2.circle(vis, (int(d[0]), int(d[1])), 5, (0,220,0), -1)

cv2.imwrite("check-3f-full.png", vis)
print("check-3f-full.png")

crop = vis[860:1560, 1130:1791]
crop = cv2.resize(crop, (int(crop.shape[1]*1.7), int(crop.shape[0]*1.7)), interpolation=cv2.INTER_LANCZOS4)
cv2.imwrite("check-3f-east.png", crop)
print("check-3f-east.png", crop.shape)
