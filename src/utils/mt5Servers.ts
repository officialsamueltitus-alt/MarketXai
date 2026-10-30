// MT5 servers of widely used brokers (owner-requested), offered as suggestions in the agent's MT5 link form. They are
// the commonly published names; brokers add servers over time, so the form also asks the live MT5 server directory
// (GET /api/agent/mt5/servers) and the trader can always type their own exactly as MT5 shows it.

export const MT5_BROKER_SERVERS: Array<{ broker: string; servers: string[] }> = [
  { broker: 'Exness', servers: ['Exness-MT5Real', 'Exness-MT5Real2', 'Exness-MT5Real3', 'Exness-MT5Real4', 'Exness-MT5Real5', 'Exness-MT5Real6', 'Exness-MT5Real7', 'Exness-MT5Real8', 'Exness-MT5Real9', 'Exness-MT5Real10', 'Exness-MT5Real11', 'Exness-MT5Real12', 'Exness-MT5Real15', 'Exness-MT5Real17', 'Exness-MT5Real18', 'Exness-MT5Real19', 'Exness-MT5Real20', 'Exness-MT5Real23', 'Exness-MT5Real24', 'Exness-MT5Real25', 'Exness-MT5Real26', 'Exness-MT5Real27', 'Exness-MT5Real28', 'Exness-MT5Real29', 'Exness-MT5Real30', 'Exness-MT5Real31', 'Exness-MT5Real32', 'Exness-MT5Real33', 'Exness-MT5Real34', 'Exness-MT5Real35', 'Exness-MT5Real36', 'Exness-MT5Real37', 'Exness-MT5Real38', 'Exness-MT5Real39', 'Exness-MT5Trial', 'Exness-MT5Trial2', 'Exness-MT5Trial3', 'Exness-MT5Trial4', 'Exness-MT5Trial5', 'Exness-MT5Trial6', 'Exness-MT5Trial7', 'Exness-MT5Trial8', 'Exness-MT5Trial9', 'Exness-MT5Trial10', 'Exness-MT5Trial11', 'Exness-MT5Trial12', 'Exness-MT5Trial14', 'Exness-MT5Trial15'] },
  { broker: 'IC Markets', servers: ['ICMarketsSC-MT5', 'ICMarketsSC-MT5-2', 'ICMarketsSC-MT5-4', 'ICMarketsSC-Demo', 'ICMarketsEU-MT5', 'ICMarketsEU-Demo', 'ICMarkets-MT5', 'ICMarkets-Demo'] },
  { broker: 'Pepperstone', servers: ['Pepperstone-MT5-Live01', 'Pepperstone-Live', 'Pepperstone-Demo', 'PepperstoneUK-Live', 'PepperstoneUK-Demo'] },
  { broker: 'XM', servers: ['XMGlobal-MT5', 'XMGlobal-MT5 2', 'XMGlobal-MT5 3', 'XMGlobal-MT5 4', 'XMGlobal-MT5 5', 'XMGlobal-MT5 6', 'XMGlobal-MT5 7', 'XMGlobal-MT5 Demo', 'XMGlobal-MT5 Demo 2', 'XM.COM-MT5', 'XM.COM-MT5 Demo'] },
  { broker: 'HFM (HotForex)', servers: ['HFMarketsGlobal-Live', 'HFMarketsGlobal-Live2', 'HFMarketsGlobal-Live3', 'HFMarketsGlobal-Demo', 'HFMarketsSV-Live Server', 'HFMarketsSV-Demo Server', 'HFMarketsKE-Live Server'] },
  { broker: 'FBS', servers: ['FBS-Real', 'FBS-Real-2', 'FBS-Real-3', 'FBS-Demo'] },
  { broker: 'Deriv', servers: ['DerivSVG-Server', 'DerivSVG-Server-02', 'DerivSVG-Server-03', 'DerivBVI-Server', 'DerivBVI-Server-02', 'DerivVU-Server', 'DerivVU-Server-02', 'Deriv-Demo', 'Deriv-Server', 'Deriv-Server-02'] },
  { broker: 'Octa', servers: ['OctaFX-Real', 'OctaFX-Real2', 'OctaFX-Demo', 'OctaInvesting-Real', 'OctaInvesting-Demo'] },
  { broker: 'JustMarkets', servers: ['JustMarkets-Live', 'JustMarkets-Live2', 'JustMarkets-Live3', 'JustMarkets-Demo', 'JustMarkets-Demo2'] },
  { broker: 'Headway', servers: ['Headway-Real', 'Headway-Demo'] },
  { broker: 'Tickmill', servers: ['Tickmill-Live', 'Tickmill-Demo', 'TickmillEU-Live', 'TickmillEU-Demo', 'TickmillUK-Live'] },
  { broker: 'RoboForex', servers: ['RoboForex-ECN', 'RoboForex-Pro', 'RoboForex-Demo', 'RoboForex-ECN-2'] },
  { broker: 'Vantage', servers: ['VantageInternational-Live', 'VantageInternational-Live 2', 'VantageInternational-Live 3', 'VantageInternational-Live 4', 'VantageInternational-Demo'] },
  { broker: 'FXTM', servers: ['ForexTimeFXTM-Live01', 'ForexTimeFXTM-Live02', 'ForexTimeFXTM-Demo01'] },
  { broker: 'FP Markets', servers: ['FPMarketsLLC-Live', 'FPMarketsLLC-Demo', 'FPMarketsSC-Live', 'FPMarketsSC-Demo', 'FPMarkets-Live', 'FPMarkets-Demo'] },
  { broker: 'Admirals', servers: ['AdmiralsGroup-Live', 'AdmiralsGroup-Demo', 'AdmiralsSC-Live', 'AdmiralsSC-Demo'] },
  { broker: 'AvaTrade', servers: ['Ava-Real 1-MT5', 'Ava-Demo 1-MT5'] },
  { broker: 'Eightcap', servers: ['Eightcap-Live', 'Eightcap-Demo'] },
  { broker: 'Fusion Markets', servers: ['FusionMarkets-Live', 'FusionMarkets-Demo'] },
  { broker: 'Blueberry Markets', servers: ['BlueberryMarkets-Live', 'BlueberryMarkets-Demo'] },
  { broker: 'Alpari', servers: ['Alpari-MT5', 'Alpari-MT5-Demo'] },
  { broker: 'Axi', servers: ['Axi-US50-Live', 'Axi-US51-Live', 'Axi-US50-Demo'] },
  { broker: 'Weltrade', servers: ['Weltrade-Live', 'Weltrade-Demo'] },
  { broker: 'TenTrade', servers: ['TenTrade-Server', 'TenTrade-Demo'] },
  { broker: 'FTMO', servers: ['FTMO-Server', 'FTMO-Server2', 'FTMO-Server3', 'FTMO-Server4', 'FTMO-Demo', 'FTMO-Demo2'] },
  { broker: 'FundedNext', servers: ['FundedNext-Server', 'FundedNext-Server 2', 'FundedNext-Server 3'] },
  { broker: 'The5ers', servers: ['FivePercentOnline-Real'] },
  { broker: 'MetaQuotes (demo)', servers: ['MetaQuotes-Demo'] },
];

export const MT5_SERVER_LIST: Array<{ broker: string; server: string }> = MT5_BROKER_SERVERS.flatMap(b => b.servers.map(server => ({ broker: b.broker, server })));

const fold = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Suggestions for what the trader typed: server names first, then brokers whose name matches (at most `limit`) */
export function suggestMt5Servers(query: string, limit = 12): Array<{ broker: string; server: string }> {
  const q = fold(query);
  if (!q) return [];
  const starts = MT5_SERVER_LIST.filter(x => fold(x.server).startsWith(q));
  const inside = MT5_SERVER_LIST.filter(x => !fold(x.server).startsWith(q) && (fold(x.server).includes(q) || fold(x.broker).includes(q)));
  return [...starts, ...inside].slice(0, limit);
}
