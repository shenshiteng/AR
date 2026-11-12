/* 第二实验楼 5 层
   由 tools/gen_floors.py 生成，不要手改；改完重跑脚本。 */
window.FLOOR_DATA_BY_ID = window.FLOOR_DATA_BY_ID || {};
window.FLOOR_DATA_BY_ID["B2-5"] = {
  "id": "B2-5",
  "name": "5层",
  "building": "第二实验楼",
  "image": "../../assets/floors/B2-5F.jpg",
  "imageWidth": 1791,
  "imageHeight": 1920,
  "pxPerMeter": 26.0,
  "originPx": [
    888,
    1049.5
  ],
  "bounds": {
    "x1": 102,
    "y1": 361,
    "x2": 1320,
    "y2": 658
  },
  "wallHeight": 1.8,
  "rooms": [
    {
      "id": "WC-N1",
      "name": "女厕（西北，贴西外墙）",
      "kind": "toilet",
      "x1": 102,
      "y1": 361,
      "x2": 190,
      "y2": 442,
      "door": "S",
      "doorT": 0.38,
      "doorW": 0.9,
      "swing": "out",
      "hinge": "lo"
    },
    {
      "id": "WC-N2",
      "name": "男厕（西北，女厕东侧）",
      "kind": "toilet",
      "x1": 190,
      "y1": 361,
      "x2": 251,
      "y2": 442,
      "door": "S",
      "doorT": 0.55,
      "doorW": 0.9,
      "swing": "out",
      "hinge": "hi"
    },
    {
      "id": "STAIR-NW",
      "name": "西北楼梯（五楼，双跑·门朝南出走廊）",
      "kind": "stair",
      "x1": 251,
      "y1": 361,
      "x2": 321,
      "y2": 442,
      "door": "S",
      "doorT": 0.5,
      "doorW": 1.2,
      "swing": "out",
      "leaf": 2
    },
    {
      "id": "508",
      "name": "使用空间（508）",
      "kind": "room",
      "x1": 321,
      "y1": 361,
      "x2": 531,
      "y2": 442,
      "door": "S",
      "doorT": 0.5,
      "doorW": 1.05,
      "swing": "in"
    },
    {
      "id": "507",
      "name": "创新实验室-1",
      "kind": "lab",
      "x1": 531,
      "y1": 361,
      "x2": 743,
      "y2": 442,
      "door": "S",
      "doorT": 0.5,
      "doorW": 1.05,
      "swing": "in"
    },
    {
      "id": "504",
      "name": "创新实验室-2",
      "kind": "lab",
      "x1": 743,
      "y1": 361,
      "x2": 953,
      "y2": 442,
      "door": "S",
      "doorT": 0.5,
      "doorW": 1.05,
      "swing": "in"
    },
    {
      "id": "503",
      "name": "创新实验室-3",
      "kind": "lab",
      "x1": 953,
      "y1": 361,
      "x2": 1171,
      "y2": 442,
      "door": "S",
      "doorT": 0.5,
      "doorW": 1.05,
      "swing": "in"
    },
    {
      "id": "STAIR-NE",
      "name": "东楼梯（五楼，双跑·门朝南正对 501）",
      "kind": "stair",
      "x1": 1253,
      "y1": 361,
      "x2": 1320,
      "y2": 442,
      "door": "S",
      "doorT": 0.5,
      "doorW": 1.2,
      "swing": "out",
      "leaf": 2
    },
    {
      "id": "510",
      "name": "软件实验室",
      "kind": "lab",
      "x1": 102,
      "y1": 495,
      "x2": 321,
      "y2": 658,
      "door": "N",
      "doorT": 0.5,
      "doorW": 1.05,
      "swing": "in"
    },
    {
      "id": "509",
      "name": "综合实验室",
      "kind": "lab",
      "x1": 321,
      "y1": 495,
      "x2": 531,
      "y2": 658,
      "door": "N",
      "doorT": 0.5,
      "doorW": 1.05,
      "swing": "in"
    },
    {
      "id": "506",
      "name": "实践实验室",
      "kind": "lab",
      "x1": 531,
      "y1": 495,
      "x2": 743,
      "y2": 658,
      "door": "N",
      "doorT": 0.5,
      "doorW": 1.05,
      "swing": "in"
    },
    {
      "id": "505",
      "name": "中心实验室",
      "kind": "lab",
      "x1": 743,
      "y1": 495,
      "x2": 953,
      "y2": 658,
      "door": "N",
      "doorT": 0.5,
      "doorW": 1.05,
      "swing": "in"
    },
    {
      "id": "502",
      "name": "智能车跑道（电子学院大学生创新中心）",
      "kind": "lab",
      "x1": 953,
      "y1": 495,
      "x2": 1171,
      "y2": 658,
      "door": "N",
      "doorT": 0.5,
      "doorW": 1.1,
      "swing": "in"
    },
    {
      "id": "501",
      "name": "大学生创新中心（电子学院）",
      "kind": "lab",
      "x1": 1171,
      "y1": 495,
      "x2": 1320,
      "y2": 658,
      "door": "N",
      "doorT": 0.5,
      "doorW": 1.2,
      "swing": "in"
    }
  ],
  "spurs": [
    {
      "id": "SPUR-NE-VEST",
      "name": "东楼梯前室（503 与东楼梯之间，南接北走廊）",
      "x1": 1171,
      "y1": 361,
      "x2": 1253,
      "y2": 442
    }
  ],
  "corridors": [
    {
      "id": "COR-N",
      "name": "北侧东西向主廊（贯通整层）",
      "x1": 102,
      "y1": 442,
      "x2": 1320,
      "y2": 495
    }
  ],
  "wallRuns": [],
  "fixtures": [],
  "glassWalls": [],
  "perimeter": [
    {
      "x1": 102,
      "y1": 361,
      "x2": 1320,
      "y2": 361
    },
    {
      "x1": 1320,
      "y1": 361,
      "x2": 1320,
      "y2": 658
    },
    {
      "x1": 1320,
      "y1": 658,
      "x2": 102,
      "y2": 658
    },
    {
      "x1": 102,
      "y1": 658,
      "x2": 102,
      "y2": 361
    }
  ],
  "perimeterHoles": [],
  "stairs": [
    {
      "id": "ST-NW5",
      "name": "西北楼梯（五楼，双跑）",
      "x1": 251,
      "y1": 361,
      "x2": 321,
      "y2": 442,
      "tread": 5,
      "dir": "NS"
    },
    {
      "id": "ST-NE5",
      "name": "东楼梯（五楼，双跑·501 正上方）",
      "x1": 1253,
      "y1": 361,
      "x2": 1320,
      "y2": 442,
      "tread": 5,
      "dir": "NS"
    }
  ],
  "exterior": [],
  "startPx": {
    "x": 600,
    "y": 468
  },
  "startName": "北走廊"
};
