# 四国一周 2026 — サイクリング行程ビューア

2026年9月19日（土）〜9月26日（土）の四国一周サイクリング（大分市寺崎町 発着）の
スケジュール・走行ルート・食事/休憩/夜のおすすめスポットを、スマートフォンから確認するための静的WEBアプリ。

## 特徴

- **地図とルート** — Leaflet + OpenStreetMap / CyclOSM。日別の走行ルートを実道路に沿った GeoJSON で表示
- **タイムライン** — 出発・到着・立寄りの時刻を、休憩込み平均速度（平坦20km/h・山岳17km/h）で算出
- **スポット情報** — 食事・休憩・観光・宿泊・「地のもの＋お酒」の夜の店。タップで営業時間/電話/Googleマップリンク
- **プラン切替** — 9/23〜24 のバッファ日は Plan A（今治拠点で往復）/ Plan B（尾道1泊縦断）を切替表示
- **オフライン寄りの設計** — ビルド不要の素の HTML/CSS/JS。ルートは静的 GeoJSON で同梱し、実行時に外部ルーティングAPIを呼ばない

## 構成

```
index.html          画面の骨格
style.css           モバイルファースト（375px基準）のスタイル
app.js              データ読込・地図描画・タイムライン描画
manifest.json       ホーム画面に追加（PWA風）
data/plan.json      全行程データ（日程・タイムライン・スポット）
data/routes/*.geojson   BRouter で生成した日別ルート
data/route_summary.json 各ルートの距離・獲得標高
research.md         スポット・宿・フェリーの調査メモ（出典付き）
```

## ローカルで動かす

```bash
npx serve .
# → http://localhost:3000
```

`file://` で直接開くと `fetch` が CORS で失敗するため、必ず HTTP サーバ経由で開くこと。

## データを直す

行程の変更は `data/plan.json` を編集するだけで反映される。
ルート線を引き直す場合は BRouter の公開APIを使う:

```
https://brouter.de/brouter?lonlats=<lon>,<lat>|<lon>,<lat>&profile=trekking&alternativeidx=0&format=geojson
```

## 注意

時刻は目安。フェリーと宿泊（フレックスホテル宿毛・ホテルタウン元町・快活CLUB徳島大学前・喜助の宿）は予約済み・確定。
店舗の営業時間は変わることがあるため、当日は各店の公式情報を確認すること。
