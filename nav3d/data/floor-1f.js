/* 第二实验楼 1 层
   由 tools/gen_1f.py 生成，不要手改；改完重跑脚本。
   坐标全部实测自 docs/img/floor-1f-photo.jpg（已做平场校正）。
   门位由 tools/doors_place_1f.py 按「门必须朝相邻走廊 + 实测开口」确定。
   ⚠ 1F 结构与 2/3/4/5 层不同，未沿用任何其他层的骨架。 */
window.FLOOR_DATA_BY_ID = window.FLOOR_DATA_BY_ID || {};
window.FLOOR_DATA_BY_ID["B2-1"] = {
  "id": "B2-1",
  "name": "一层",
  "building": "第二实验楼",
  "image": "../../docs/img/floor-1f-photo.jpg",
  "imageWidth": 1773,
  "imageHeight": 2364,
  "pxPerMeter": 23.04,
  "originPx": [
    888,
    1049.5
  ],
  "bounds": {
    "x1": 158,
    "y1": 300,
    "x2": 1651,
    "y2": 1747
  },
  "wallHeight": 1.8,
  "atrium": {
    "x1": 561,
    "y1": 828,
    "x2": 1101,
    "y2": 1409
  },
  "rooms": [
    {
      "id": "108",
      "name": "仿真实验室-1",
      "kind": "lab",
      "x1": 182,
      "y1": 308,
      "x2": 491,
      "y2": 597,
      "door": "E",
      "doorT": 0.403,
      "doorW": 0.87,
      "swing": "in",
      "winSides": [
        {
          "k": "N",
          "t": 0.5,
          "w": 3.0
        },
        {
          "k": "W",
          "t": 0.5,
          "w": 3.0
        }
      ]
    },
    {
      "id": "109",
      "name": "仿真实验室-2",
      "kind": "lab",
      "x1": 561,
      "y1": 308,
      "x2": 734,
      "y2": 597,
      "door": "S",
      "doorT": 0.5,
      "doorW": 1.6,
      "swing": "in",
      "winSides": [
        {
          "k": "N",
          "t": 0.5,
          "w": 3.0
        }
      ]
    },
    {
      "id": "110",
      "name": "配电间",
      "kind": "service",
      "x1": 455,
      "y1": 600,
      "x2": 561,
      "y2": 672,
      "door": "E",
      "doorT": 0.646,
      "doorW": 2.0,
      "swing": "out"
    },
    {
      "id": "111",
      "name": "仿真中心值班室",
      "kind": "service",
      "x1": 561,
      "y1": 705,
      "x2": 640,
      "y2": 828,
      "door": "W",
      "doorT": 0.5,
      "doorW": 1.0,
      "swing": "out"
    },
    {
      "id": "113",
      "name": "汽车发动机实验室",
      "kind": "lab",
      "x1": 640,
      "y1": 597,
      "x2": 1101,
      "y2": 660,
      "door": "S",
      "doorT": 0.569,
      "doorW": 0.78,
      "swing": "in"
    },
    {
      "id": "112",
      "name": "轨道车辆实验室/汽车电子实验室-1",
      "kind": "lab",
      "x1": 640,
      "y1": 705,
      "x2": 1101,
      "y2": 828,
      "door": "N",
      "doorT": 0.562,
      "doorW": 0.91,
      "swing": "in"
    },
    {
      "id": "114",
      "name": "值班室",
      "kind": "service",
      "x1": 1153,
      "y1": 660,
      "x2": 1242,
      "y2": 720,
      "door": "W",
      "doorT": 0.492,
      "doorW": 2.4,
      "swing": "out"
    },
    {
      "id": "107",
      "name": "土木工程材料实验室-3",
      "kind": "lab",
      "x1": 372,
      "y1": 828,
      "x2": 561,
      "y2": 1304,
      "door": "E",
      "doorT": 0.5,
      "doorW": 1.2,
      "swing": "in",
      "win": true
    },
    {
      "id": "106",
      "name": "土木工程材料实验室-2",
      "kind": "lab",
      "x1": 372,
      "y1": 1304,
      "x2": 561,
      "y2": 1412,
      "door": "E",
      "doorT": 0.5,
      "doorW": 1.2,
      "swing": "in"
    },
    {
      "id": "105",
      "name": "配电间",
      "kind": "service",
      "x1": 372,
      "y1": 1412,
      "x2": 561,
      "y2": 1468,
      "door": "E",
      "doorT": 0.527,
      "doorW": 2.26,
      "swing": "out"
    },
    {
      "id": "104",
      "name": "航空测绘实验室",
      "kind": "lab",
      "x1": 372,
      "y1": 1468,
      "x2": 561,
      "y2": 1551,
      "door": "E",
      "doorT": 0.687,
      "doorW": 2.22,
      "swing": "in"
    },
    {
      "id": "101",
      "name": "土木工程材料实验室-1/土力学/工程结构-1/力学基础-1",
      "kind": "lab",
      "x1": 561,
      "y1": 1409,
      "x2": 1101,
      "y2": 1747,
      "door": "E",
      "doorT": 0.5,
      "doorW": 1.8,
      "swing": "in",
      "win": true
    },
    {
      "id": "103",
      "name": "轨道工程实验室（北交大研究生）",
      "kind": "lab",
      "x1": 158,
      "y1": 1600,
      "x2": 343,
      "y2": 1747,
      "door": "N",
      "doorT": 0.5,
      "doorW": 1.2,
      "swing": "in",
      "win": true
    },
    {
      "id": "102",
      "name": "沥青实验室",
      "kind": "lab",
      "x1": 343,
      "y1": 1600,
      "x2": 535,
      "y2": 1747,
      "door": "N",
      "doorT": 0.5,
      "doorW": 1.2,
      "swing": "in",
      "win": true
    },
    {
      "id": "115",
      "name": "汽车底盘实验室-1",
      "kind": "lab",
      "x1": 1155,
      "y1": 1040,
      "x2": 1380,
      "y2": 1117,
      "door": "S",
      "doorT": 0.607,
      "doorW": 2.4,
      "swing": "in"
    },
    {
      "id": "116",
      "name": "汽车底盘实验室-1",
      "kind": "lab",
      "x1": 1155,
      "y1": 1174,
      "x2": 1310,
      "y2": 1306,
      "door": "N",
      "doorT": 0.461,
      "doorW": 0.7,
      "swing": "in"
    },
    {
      "id": "117",
      "name": "汽车底盘实验室-2",
      "kind": "lab",
      "x1": 1310,
      "y1": 1174,
      "x2": 1470,
      "y2": 1306,
      "door": "N",
      "doorT": 0.472,
      "doorW": 0.78,
      "swing": "in"
    },
    {
      "id": "120",
      "name": "汽车底盘实验室-3",
      "kind": "lab",
      "x1": 1470,
      "y1": 1174,
      "x2": 1651,
      "y2": 1306,
      "door": "N",
      "doorT": 0.37,
      "doorW": 0.65,
      "swing": "in"
    },
    {
      "id": "118",
      "name": "机械学院仓库",
      "kind": "store",
      "x1": 1470,
      "y1": 1053,
      "x2": 1520,
      "y2": 1117,
      "door": "S",
      "doorT": 0.75,
      "doorW": 0.61,
      "swing": "out"
    },
    {
      "id": "119",
      "name": "自律会活动室",
      "kind": "room",
      "x1": 1520,
      "y1": 1053,
      "x2": 1580,
      "y2": 1117,
      "door": "S",
      "doorT": 0.217,
      "doorW": 0.65,
      "swing": "out"
    },
    {
      "id": "121",
      "name": "科协活动室",
      "kind": "room",
      "x1": 1580,
      "y1": 1053,
      "x2": 1651,
      "y2": 1117,
      "door": "S",
      "doorT": 0.289,
      "doorW": 0.61,
      "swing": "out"
    },
    {
      "id": "STAIR-NW",
      "name": "楼梯间（西北角）",
      "kind": "stair",
      "x1": 375,
      "y1": 660,
      "x2": 484,
      "y2": 828,
      "door": "E",
      "doorT": 0.149,
      "doorW": 1.61,
      "swing": "out"
    },
    {
      "id": "STAIR-E",
      "name": "楼梯间（东翼 115 旁）",
      "kind": "stair",
      "x1": 1380,
      "y1": 1040,
      "x2": 1470,
      "y2": 1117,
      "door": "S",
      "doorT": 0.5,
      "doorW": 1.4,
      "swing": "out"
    },
    {
      "id": "STAIR-SE",
      "name": "楼梯间（东南角·101 东侧）",
      "kind": "stair",
      "x1": 1101,
      "y1": 1500,
      "x2": 1200,
      "y2": 1600,
      "door": "W",
      "doorT": 0.5,
      "doorW": 1.5,
      "swing": "out"
    },
    {
      "id": "STAIR-SW",
      "name": "楼梯间（西南角）",
      "kind": "stair",
      "x1": 268,
      "y1": 1415,
      "x2": 372,
      "y2": 1560,
      "door": "S",
      "doorT": 0.5,
      "doorW": 1.3,
      "swing": "out"
    },
    {
      "id": "WC-N1",
      "name": "男厕（西北）",
      "kind": "toilet",
      "x1": 268,
      "y1": 680,
      "x2": 322,
      "y2": 828,
      "door": "N",
      "doorT": 0.537,
      "doorW": 2.13,
      "swing": "out"
    },
    {
      "id": "WC-N2",
      "name": "女厕（西北）",
      "kind": "toilet",
      "x1": 322,
      "y1": 680,
      "x2": 375,
      "y2": 828,
      "door": "N",
      "doorT": 0.764,
      "doorW": 1.04,
      "swing": "out"
    },
    {
      "id": "WC-E1",
      "name": "女厕（东）",
      "kind": "toilet",
      "x1": 1153,
      "y1": 828,
      "x2": 1242,
      "y2": 893,
      "door": "E",
      "doorT": 0.492,
      "doorW": 2.4,
      "swing": "out"
    },
    {
      "id": "WC-E2",
      "name": "男厕（东）",
      "kind": "toilet",
      "x1": 1153,
      "y1": 893,
      "x2": 1242,
      "y2": 943,
      "door": "W",
      "doorT": 0.45,
      "doorW": 1.13,
      "swing": "out"
    },
    {
      "id": "WC-E3",
      "name": "盥洗室（东）",
      "kind": "toilet",
      "x1": 1153,
      "y1": 943,
      "x2": 1242,
      "y2": 997,
      "door": "W",
      "doorT": 0.5,
      "doorW": 0.9,
      "swing": "out"
    },
    {
      "id": "WC-S1",
      "name": "女厕（西南）",
      "kind": "toilet",
      "x1": 150,
      "y1": 1415,
      "x2": 250,
      "y2": 1505,
      "door": "S",
      "doorT": 0.5,
      "doorW": 0.9,
      "swing": "out"
    },
    {
      "id": "WC-S2",
      "name": "男厕（西南）",
      "kind": "toilet",
      "x1": 250,
      "y1": 1415,
      "x2": 350,
      "y2": 1505,
      "door": "S",
      "doorT": 0.705,
      "doorW": 2.35,
      "swing": "out"
    }
  ],
  "corridors": [
    {
      "id": "COR-NW-VERT",
      "name": "108/109 之间的南北向走廊",
      "x1": 491,
      "y1": 308,
      "x2": 561,
      "y2": 672
    },
    {
      "id": "COR-N",
      "name": "北侧东西向走廊（113 与 112 之间）",
      "x1": 561,
      "y1": 620,
      "x2": 1153,
      "y2": 705
    },
    {
      "id": "COR-NW",
      "name": "西北角走廊（110/111 门前，接西北楼梯厕所与西走廊）",
      "x1": 455,
      "y1": 672,
      "x2": 561,
      "y2": 828
    },
    {
      "id": "COR-NE",
      "name": "东北角竖向走廊（114 下方接东翼）",
      "x1": 1101,
      "y1": 660,
      "x2": 1153,
      "y2": 1040
    },
    {
      "id": "COR-E",
      "name": "东翼纵向走廊（WC 东侧，115 与 116 之间）",
      "x1": 1242,
      "y1": 828,
      "x2": 1310,
      "y2": 1174
    },
    {
      "id": "COR-EH",
      "name": "东翼横向走廊（上排与 116/117/120 之间）",
      "x1": 1155,
      "y1": 1117,
      "x2": 1651,
      "y2": 1174
    },
    {
      "id": "COR-W",
      "name": "西侧纵向走廊（107/106/105/104 东侧）",
      "x1": 561,
      "y1": 828,
      "x2": 640,
      "y2": 1551
    },
    {
      "id": "COR-S",
      "name": "南侧横向走廊（101 北侧，连 102/103 与西南楼梯）",
      "x1": 158,
      "y1": 1551,
      "x2": 1101,
      "y2": 1600
    },
    {
      "id": "COR-SE",
      "name": "东南角走廊（101 东侧接东南楼梯）",
      "x1": 1101,
      "y1": 1409,
      "x2": 1155,
      "y2": 1600
    },
    {
      "id": "COR-WC-S",
      "name": "西南厕所前廊（WC-S1/S2 南侧，连通西南楼梯与南走廊）",
      "x1": 150,
      "y1": 1505,
      "x2": 372,
      "y2": 1560
    },
    {
      "id": "COR-WC-NW",
      "name": "西北厕所前厅（WC-N1/N2 北侧，接西北楼梯口）",
      "x1": 268,
      "y1": 600,
      "x2": 561,
      "y2": 672
    },
    {
      "id": "COR-E-WC",
      "name": "东侧厕所前廊（WC-E1/E2/E3 西侧）",
      "x1": 1101,
      "y1": 828,
      "x2": 1242,
      "y2": 1053
    }
  ],
  "stairs": [
    {
      "id": "ST-NW",
      "name": "西北楼梯",
      "x1": 375,
      "y1": 660,
      "x2": 484,
      "y2": 828,
      "tread": 8,
      "dir": "NS"
    },
    {
      "id": "ST-E",
      "name": "东翼楼梯",
      "x1": 1380,
      "y1": 1040,
      "x2": 1470,
      "y2": 1117,
      "tread": 7,
      "dir": "NS"
    },
    {
      "id": "ST-SE",
      "name": "东南楼梯",
      "x1": 1101,
      "y1": 1500,
      "x2": 1200,
      "y2": 1600,
      "tread": 7,
      "dir": "NS"
    },
    {
      "id": "ST-SW",
      "name": "西南楼梯",
      "x1": 158,
      "y1": 1500,
      "x2": 268,
      "y2": 1600,
      "tread": 7,
      "dir": "NS"
    }
  ],
  "fixtures": [],
  "startPx": {
    "x": 820,
    "y": 700
  },
  "startName": "北侧走廊（汽车发动机实验室门前）",
  "levelInfo": {
    "site": "第二实验楼 · 1层",
    "floors": [
      {
        "id": "B2-1",
        "label": "1F",
        "name": "1层",
        "ready": true,
        "theme": "土木/交通/汽车 实验教学"
      }
    ]
  }
};
