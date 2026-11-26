# Topmost Clock

常に手前に表示する時計アプリです。天気・雨雲レーダー・PC の状態・地震情報を順番に表示します。
緊急地震速報や地震情報を受信すると、ほかの表示を止めて地震情報だけを表示します。

Electron（HTML/CSS/JavaScript）で作っています。Windows と Linux で動きます。

## インストール

[Releases](https://github.com/otsukisama06/clock_eew_app/releases/latest) から OS に合ったファイルをダウンロードします。

| OS | ファイル | 使い方 |
|---|---|---|
| Windows | `TopmostClock-Setup-*.exe` | 実行してインストール。デスクトップとスタートメニューにショートカットが作られます |
| Linux (Ubuntu / Debian) | `TopmostClock-*-linux-amd64.deb` | `sudo apt install ./TopmostClock-*.deb`。アプリ一覧に登録され、初回起動時にデスクトップへショートカットを作ります |
| Linux (その他) | `TopmostClock-*-linux-x86_64.AppImage` | `chmod +x` して実行。初回起動時にデスクトップとアプリ一覧へショートカットを作ります |

- ショートカットを消してしまったときは、タスクトレイのメニュー「デスクトップにショートカットを作成」で作り直せます。
- Windows ではコード署名をしていないため、SmartScreen の警告が出ることがあります（「詳細情報」→「実行」）。
- Linux でタスクトレイのアイコンを出すには、デスクトップ環境が AppIndicator に対応している必要があります（GNOME は拡張機能「AppIndicator Support」が必要）。

## ソースから起動（開発用）

```powershell
npm install
npm start
npm run shortcut          # Windows: ソースを起動するショートカットをデスクトップに作成
```

- ショートカットか `start_clock_hidden.vbs` から起動すると、ターミナルは表示されません。
- Windows 起動時に自動で起動するには `powershell -File scripts/make-shortcut.ps1 -Startup` を実行します。

## リリースの作り方

`package.json` の `version` を上げてコミットし、同じ番号のタグを push します。GitHub Actions が Windows 版と Linux 版をビルドして Releases に載せます（`.github/workflows/release.yml`）。

```powershell
git tag v2.0.1
git push origin v2.0.1
```

手元でビルドする場合は `npm run dist:win`（Windows 上）/ `npm run dist:linux`（Linux 上）。出力先は `dist/` です。

## 操作

| 操作 | 内容 |
|---|---|
| 上部バーをドラッグ | 移動（Windows のスナップ対応: 画面端へドラッグ / Win+矢印キー / 最大化ボタンにマウスを乗せてレイアウト選択） |
| 上部バー以外をドラッグ（地図・ボタン以外） | 移動のみ（スナップなし） |
| 上部バーをダブルクリック | 最大化 / 元に戻す |
| F6 | 右上へ移動 |
| ウィンドウの端をドラッグ | サイズ変更（表示は自動で拡大・縮小） |
| 上部のタブ / → キー | ページ切替（マウスが乗っている間は自動切替を止めます。設定で変更可） |
| 上部の「⚙ 設定」 / トレイの「設定...」 | 設定ウィンドウ。ページごとの表示時間、自動切替に含めるページ、マウスが乗っているときに止めるかを設定 |
| Ctrl+Alt+T（Linux は Ctrl+Alt+Shift+T） | クリック透過の切替（どこからでも使えます） |
| Esc | 地震表示を閉じて通常表示に戻る |
| タスクトレイのアイコン | 手前表示・不透明度・音・テスト表示・終了 |

## 表示するページ

- **時計**: 7 セグメント表示
- **天気**: Open-Meteo の現在の天気と 12 時間予報
- **雨雲**: 気象庁の高解像度降水ナウキャスト。現在（最新の実況）から 1 時間後までの予報を再生します（過去の観測は表示しません）。地図はドラッグやホイールで動かせます。ダブルクリックすると元の位置に戻ります。
- **PC**: CPU、メモリ、ディスク、ネットワーク、稼働時間
- **地震**: 最新の地震情報と履歴

## 地震情報

- 緊急地震速報: [Wolfx](https://wolfx.jp/) の WebSocket（`wss://ws-api.wolfx.jp/jma_eew`）
- 地震情報（震度速報・震源情報など）: [P2P地震情報](https://www.p2pquake.net/) の WebSocket と API

受信すると次のように表示します。

- 予報は黄色、警報は赤色の枠とバナーで表示します。最小化していても前面に出します。
- OS の通知（Windows の通知センター / Linux の通知）にも出します。緊急地震速報は第 1 報・警報への切り替え・取消のとき、地震情報は受信のたびに通知します。通知をクリックすると時計を表示します。
  - Windows 11: 「重要な通知」として送るので、応答不可（おやすみモード）中でも表示されます。初回に Windows から「重要な通知を許可しますか？」と聞かれたら許可してください。あとから変える場合は「設定 → システム → 通知 → Topmost Clock」で設定します。
  - Linux: 緊急度「critical」で送ります。GNOME などではおやすみモード中でも表示されます。
  - ソースから起動した場合は、通知を出すためにスタートメニューへ「Topmost Clock (開発版)」のショートカットを自動で作ります。
- 地図には震央と P 波・S 波の円（簡易計算による推定）を表示します。
- 自宅（`CLOCK_LAT` / `CLOCK_LON`）に主要動が届くまでの秒数を表示します（推定値）。
- 最終報から 90 秒、取消から 20 秒、続報が来なくなってから 3 分たつと通常表示に戻ります。
- 震度の配色は [rsquake](https://github.com/neruha/rsquake) を参考にしています。
- 表記（予想最大震度・発生時刻・深さ・マグニチュードなど）は気象庁の緊急地震速報・地震情報に合わせています。

## 現在地の警報・注意報

- Windows の位置情報サービスで現在地を取得します。取得できないとき（Linux では常に）は `.env` の `CLOCK_LAT` / `CLOCK_LON` を使います。
- 国土地理院の逆ジオコーダで市区町村を特定し、気象庁の警報・注意報を 5 分ごとに取得します。
- 発表中の警報・注意報は、上部バー（地震表示中も表示）と天気ページに気象庁の配色で表示します。
- 現在地は天気、自宅マーカー、揺れの到達予測にも使います。

> 本アプリの表示は参考情報です。到達時刻や円は簡易モデルによる推定です。

## 設定 (.env)

設定ファイル `.env` は次の場所に置きます（ソースから起動するときは、プロジェクトのフォルダに置いたものも読みます）。

- Windows: `%APPDATA%\topmost-clock\.env`
- Linux: `~/.config/topmost-clock/.env`

| キー | 既定値 | 内容 |
|---|---|---|
| `CLOCK_CITY` | Toyota | 表示する地名 |
| `CLOCK_LAT` / `CLOCK_LON` | 35.083 / 137.156 | 現在地が取得できないときの地点 |
| `CLOCK_RADAR_LAT` / `CLOCK_RADAR_LON` | 現在地 | 雨雲レーダーの中心（設定すると固定） |
| `CLOCK_RADAR_ZOOM` | 8 | 雨雲レーダーの初期ズーム（4〜10） |
| `CLOCK_PAGE_SECONDS_CLOCK` など | 15 / 9 | 各ページの表示秒数（`_WEATHER` `_RADAR` `_STATUS` `_QUAKE`） |
| `CLOCK_QUAKE_MIN_SCALE` | 10 | 地震情報で画面を切り替える最小震度（10=震度1, 30=震度3, 40=震度4, 45=5弱） |
| `CLOCK_QUAKE_HOLD_SECONDS` | 60 | 地震情報を表示し続ける秒数 |
| `CLOCK_EEW_TRAINING` | 0 | 1 にすると訓練報も表示 |

ウィンドウの位置・不透明度・音の設定は同じフォルダの `settings.json` に保存されます。

## 旧バージョン

`clock_topmost.py` は以前の Python（Tkinter）版です。新しい版では使いません。
