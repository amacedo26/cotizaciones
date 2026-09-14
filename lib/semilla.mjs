// Los puntos medidos antes de mudarse a Netlify: por corridas de GitHub
// Actions y por el servidor que corría en la Mac, que midió cada 10 minutos.
// Se fusionan con lo que haya en el almacén en cada corrida; como la fusión
// deduplica por marca de tiempo, repetirlo no cuesta nada y hace que la
// serie se repare sola si el almacén se pierde.
export const SEMILLA = [
  {
    "t": "2026-09-14T14:58:12.073Z",
    "oro": 4276.5,
    "plata": 62.997002,
    "dxy": 99.168,
    "eurusd": 1.1592,
    "usdjpy": 154.04,
    "bcu": 40.2,
    "bevsa": null
  },
  {
    "t": "2026-09-14T15:58:31.099Z",
    "oro": 4291.899902,
    "plata": 63.48,
    "dxy": 99.483,
    "eurusd": 1.1551,
    "usdjpy": 154.55,
    "bcu": 40.2,
    "bevsa": null
  },
  {
    "t": "2026-09-14T19:07:41.764Z",
    "oro": 4305.899902,
    "plata": 63.714001,
    "dxy": 99.402,
    "eurusd": 1.1557,
    "usdjpy": 154.13,
    "bcu": 40.2,
    "bevsa": null
  },
  {
    "t": "2026-09-14T19:11:05.418Z",
    "oro": 4304.799805,
    "plata": 63.68,
    "dxy": 99.399,
    "eurusd": 1.1557,
    "usdjpy": 154.14,
    "bcu": 40.2,
    "bevsa": null
  },
  {
    "t": "2026-09-14T19:21:06.497Z",
    "oro": 4302.799805,
    "plata": 63.620998,
    "dxy": 99.427,
    "eurusd": 1.1554,
    "usdjpy": 154.22,
    "bcu": 40.2,
    "bevsa": null
  },
  {
    "t": "2026-09-14T19:31:05.767Z",
    "oro": 4297.5,
    "plata": 63.487,
    "dxy": 99.443,
    "eurusd": 1.1553,
    "usdjpy": 154.26,
    "bcu": 40.2,
    "bevsa": null
  },
  {
    "t": "2026-09-14T19:41:05.601Z",
    "oro": 4293.200195,
    "plata": 63.424,
    "dxy": 99.45,
    "eurusd": 1.1552,
    "usdjpy": 154.26,
    "bcu": 40.2,
    "bevsa": null
  },
  {
    "t": "2026-09-14T19:51:06.484Z",
    "oro": 4289,
    "plata": 63.307999,
    "dxy": 99.479,
    "eurusd": 1.1549,
    "usdjpy": 154.35,
    "bcu": 40.2,
    "bevsa": null,
    "brl": 5.1467,
    "arsOficial": 1505,
    "arsBlue": 1545
  },
  {
    "t": "2026-09-14T19:51:49.856Z",
    "oro": 4287.899902,
    "plata": 63.255001,
    "dxy": 99.478,
    "eurusd": 1.1549,
    "usdjpy": 154.34,
    "bcu": 40.2,
    "bevsa": null,
    "brl": 5.1467,
    "arsOficial": 1505,
    "arsBlue": 1545
  },
  {
    "t": "2026-09-14T20:01:50.935Z",
    "oro": 4284.799805,
    "plata": 63.084,
    "dxy": 99.506,
    "eurusd": 1.1546,
    "usdjpy": 154.4,
    "bcu": 40.218,
    "bevsa": null,
    "brl": 5.1486,
    "arsOficial": 1505,
    "arsBlue": 1545
  },
  {
    "t": "2026-09-14T20:11:50.659Z",
    "oro": 4287.799805,
    "plata": 63.205002,
    "dxy": 99.512,
    "eurusd": 1.1545,
    "usdjpy": 154.4,
    "bcu": 40.218,
    "bevsa": null,
    "brl": 5.149,
    "arsOficial": 1505,
    "arsBlue": 1545
  },
  {
    "t": "2026-09-14T20:21:50.713Z",
    "oro": 4295.700195,
    "plata": 63.285999,
    "dxy": 99.499,
    "eurusd": 1.1547,
    "usdjpy": 154.39,
    "bcu": 40.218,
    "bevsa": null,
    "brl": 5.1487,
    "arsOficial": 1505,
    "arsBlue": 1545
  }
];
