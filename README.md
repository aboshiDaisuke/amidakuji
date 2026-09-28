# あみだくじ - おみやげ抽選アプリ

おみやげをあみだくじで配るためのWebアプリです。

## 機能

- 参加人数の設定（2〜20人）
- 商品の一括登録（名前と個数を指定）
- あみだくじのアニメーション表示
- アニメーション速度切替（ゆっくり / ふつう / はやい）
- 「通常表示」「iPad向け」の切替と表示設定の保存
- タッチ操作対応（iPadの縦・横向き、Split View、スマホ）
- 人数が多いときは横スクロールで番号を選択
- 商品ごとのお酒・大きい商品・大当たり設定
- 辞退して交換できない商品は未配布として結果一覧に表示
- 設定と抽選途中の自動保存・復元
- 全員の結果を一覧表示
- おみやげの在庫管理（写真・個数・賞味期限。期限切れは赤、3日以内は黄色で表示）
- 在庫から、期限切れをのぞいて期限が近い順に人数分をおみやげリストへ入れる
- 抽選が終わって結果一覧を出すと、配った分を在庫から自動で引く（結果一覧から取り消しできる）
- ログインしていないときの在庫は localStorage、写真は IndexedDB に、この端末だけで保存
- みんなの在庫: 持ち主のGoogleアカウントでログインすると、どの端末でも同じ在庫と写真を使える（Firebase。下の「みんなの在庫の準備」）

## 技術構成

- 単一HTMLファイル（`index.html`）で完結
- Canvas APIによるあみだくじ描画
- Tailwind CSS（CDN）
- Font Awesome アイコン
- M PLUS Rounded 1c フォント
- 3Dキャラ表示: [model-viewer](https://modelviewer.dev/)（CDN）

## ハロウィン仕様

- 3Dキャラは `assets/halloween/*.glb` にあります。元データ（約60MB）を gltf-transform でポリゴン数を減らし、テクスチャをWebP化・meshopt圧縮して、1体あたり約0.6MBにしています
- 元データは `素材/3Dキャラ元データ/` にあります（Gitには入れていません）。作り直すときは次を実行します（`hwpumpkin_…glb` → `pumpkin.glb`）

```sh
npx @gltf-transform/cli optimize 素材/3Dキャラ元データ/hwpumpkin_かぼちゃのおばけ.glb assets/halloween/pumpkin.glb \
  --compress meshopt --texture-compress webp --texture-size 1024 \
  --simplify-ratio 0.04 --simplify-error 0.001
```

## みんなの在庫の準備（Firebase）

在庫の共有には Firebase の無料プラン（Spark）のプロジェクト `omiyage-amidakuji`（Firestore は `asia-northeast1`）を使っています。`index.html` の `FIREBASE_CONFIG` を `null` にすると、これまでどおり在庫はこの端末だけに保存されます。

ルールを変えたら、`firebase deploy --only firestore:rules` で反映します（`firebase.json` / `.firebaserc` 設定ずみ）。

プロジェクトを作りなおすときの手順:

1. [Firebase コンソール](https://console.firebase.google.com) でプロジェクトを作る（Google アナリティクスは不要）
2. Authentication → ログイン方法 で「Google」を有効にする。設定 → 承認済みドメイン に `aboshidaisuke.github.io` を足す
3. Firestore Database を作成する（場所は `asia-northeast1` など。本番環境モード）。ルール タブに `firestore.rules` の中身を貼って公開する
4. プロジェクトの設定 → マイアプリ で「ウェブ」アプリを登録し、出てきた `firebaseConfig` を `index.html` の `FIREBASE_CONFIG` に入れる
5. 公開したら、持ち主がいちばん最初にログインする（最初にログインした人が持ち主になる。ほかのアカウントでは使えない）

しくみ:

- 在庫は `shops/main/items` に1行ずつ、写真は `shops/main/photos` に商品名ごとに入る。メンバーは `shops/main` の `members`
- 個数の増減は差分で送るので、2台で同時に配っても両方の分が引かれる
- ネットが切れている間の変更は端末にためて、つながったら送る。ログアウトすると端末に写した在庫と写真は消える
- 手元での確認は Firebase エミュレーター（`firebase emulators:start --only auth,firestore`。Java が必要）で、`FIREBASE_CONFIG` を `demo-` で始まるプロジェクトにし、`connectAuthEmulator` / `connectFirestoreEmulator` をつないだコピーを使う

## 動作確認

`index.html` をブラウザで開くと利用できます。スタイルとフォントはCDNから読み込みます。

Node.jsの標準機能だけで、抽選処理・保存復元・画面切替の回帰テストを実行できます。

```sh
node --test tests/regression.test.cjs
```

画面上部の「通常表示」「iPad向け」で表示を切り替えられます。初期表示は通常表示です。選択は保存され、抽選中の切替でも結果や進行は変わりません。

iPadでは「iPad向け」を選び、番号をタップして抽選します。盤面が画面幅より広いときは横にスワイプしてください。iPad向けでは操作ボタンが画面下に追従します。商品個数は1〜1000の整数で登録できます。

## 変更履歴

### 2026-09-09

- 辞退時に交換先がない場合、その商品を未配布として保持するよう修正
- やり直し・設定画面への移動・保存データ消去で、前回のアニメーションと結果表示予約をキャンセル
- 空欄・小数・範囲外の商品個数を登録しないよう修正
- 同名商品でも個別に属性を保持し、旧形式の保存データも読み込み可能に変更
- 画面回転時に抽選済み・抽選中の経路を再計算
- 参加人数を最大20人に変更（旧データが20人を超える場合は、商品設定を引き継いで20人の設定画面に戻ります）
- iPad向けに48pxのタップ領域、横スクロール盤面、追従する操作ボタン、画面サイズに合わせた盤面の高さを追加

### 2026-03-29

**バグ修正:**
- シャッフルアルゴリズムをFisher-Yatesに変更（ランダム性の偏りを修正）
- XSS対策（innerHTML挿入箇所にエスケープ処理を追加）
- Canvas描画の解像度問題を修正（Retina対応、アニメーション中のぼやけ解消）
- `checkAllRevealed()` が現在の参加人数のみチェックするよう修正
- `resetPaths()` でくじを完全に再生成するよう修正
- 結果カード（?ボックス）が端で見切れる問題を修正

**機能追加・改善:**
- アニメーション速度切替機能（ゆっくり:5秒 / ふつう:3秒 / はやい:1.2秒）
- タッチイベント対応
- ウィンドウリサイズ時の自動再描画（デバウンス付き）
- 商品名入力でEnter → 個数フィールドにフォーカス移動（入力フロー改善）
- `roundRect` のブラウザ互換フォールバック
- 結果表示時のスムーズスクロール

**デザイン:**
- POPデザインに刷新（グラデーションタイトル、太枠ボーダー、ステッカー風シャドウ）
- 広報キャラクターイラストをヘッダーに配置
- レスポンシブ対応（aspect-ratioベースのCanvas表示）

## 通常版とハロウィン版の切り替え

- 通常版は `main` ブランチ、ハロウィン版は `halloween` ブランチにあります
- 公開サイト（GitHub Pages）は、どちらのブランチを公開するかで切り替えます

```sh
# ハロウィン版を公開
gh api -X PUT repos/aboshiDaisuke/amidakuji/pages -f "source[branch]=halloween" -f "source[path]=/"
# 通常版に戻す
gh api -X PUT repos/aboshiDaisuke/amidakuji/pages -f "source[branch]=main" -f "source[path]=/"
```

GitHub の Settings → Pages → Branch でも同じ切り替えができます。反映まで1〜2分かかります。

## 素材

`素材/` には、サイトでは直接使っていない元画像をまとめています。この端末だけに置いていて、Gitには入れていません。

- `ロゴ/`: 初代・ギャル版・ハロウィン版のロゴの元画像
- `キャラ_初代/`、`キャラ_ギャル/`、`キャラ_ハロウィン/`: キャラクターの元画像（三面図やポーズ違い）
- `3Dキャラ元データ/`: おばけ3Dキャラの元データ（1体約60MB）
- `スクショ/`: 画面確認用のスクリーンショット
- `動画/`: 今は使っていないヘッダー用の動画（大当たり演出の `あたり.mp4` はサイトで使うのでルートに置いたまま）
