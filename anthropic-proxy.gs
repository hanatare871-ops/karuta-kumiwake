/**
 * anthropic-proxy.gs
 *
 * デイトレ・エントリー復習AIアプリ (entry-review-app.html) 用の
 * Google Apps Script Webアプリ プロキシ。
 *
 * 役割:
 *   ブラウザから受け取ったリクエストを、そのまま Anthropic Messages API
 *   (https://api.anthropic.com/v1/messages) に転送するだけの薄い中継。
 *   APIキーはこのスクリプトのスクリプトプロパティにのみ保持され、
 *   ブラウザ側のコードには一切渡らない。
 *
 * ------------------------------------------------------------------
 * デプロイ手順
 * ------------------------------------------------------------------
 * 1. https://script.google.com/ で新規プロジェクトを作成し、このファイルの
 *    内容を Code.gs にすべて貼り付ける。
 *
 * 2. Anthropic Console (https://platform.claude.com/) で発行したAPIキーを、
 *    左メニューの「プロジェクトの設定」→「スクリプト プロパティ」で
 *    キー名 ANTHROPIC_API_KEY として登録する。
 *    (コード中に直接APIキーを書き込まないこと)
 *
 * 3. 右上の「デプロイ」→「新しいデプロイ」を選択。
 *    - 種類の選択: 「ウェブアプリ」
 *    - 説明: 任意 (例: entry-review-proxy)
 *    - 次のユーザーとして実行: 「自分」
 *    - アクセスできるユーザー: 「全員」
 *      (Google Workspace 組織内のみで使う場合は「組織内の全員」でも可)
 *    - 「デプロイ」をクリックし、表示された「ウェブアプリ」のURL
 *      (https://script.google.com/macros/s/xxxxx/exec) をコピーする。
 *
 * 4. entry-review-app.html を開き、「設定」セクションの
 *    「GASプロキシ Web App URL」欄に、コピーしたURLを貼り付けて保存する。
 *
 * 5. スクリプトのコードを更新した場合は、「デプロイ」→「デプロイを管理」→
 *    対象デプロイの編集アイコン→バージョン「新バージョン」を選んで
 *    再デプロイしないと変更が反映されない点に注意。
 *
 * ------------------------------------------------------------------
 * 動作確認
 * ------------------------------------------------------------------
 * デプロイ後、ブラウザでWebアプリURLに直接アクセスすると doGet() が動作し
 * "OK" と表示されればデプロイ自体は成功している。実際のAPI疎通は
 * entry-review-app.html から判定を実行して確認すること。
 */

// Anthropic Messages API のエンドポイントとAPIバージョン。
// 最新仕様は https://docs.claude.com/en/api/overview を参照のこと。
var ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
var ANTHROPIC_VERSION = "2023-06-01";

/**
 * ブラウザからの疎通確認用。
 */
function doGet(e) {
  return ContentService.createTextOutput("OK").setMimeType(ContentService.MimeType.TEXT);
}

/**
 * ブラウザからの本体リクエストを受け取り、Anthropic APIへ転送する。
 *
 * ブラウザ側は CORS プリフライト(OPTIONS)を避けるため
 * Content-Type: text/plain でJSON文字列を送信してくる。
 * GAS はどんな Content-Type でも e.postData.contents に生の本文を渡すため、
 * ここでJSONとしてパースする。
 *
 * 期待するリクエストボディ:
 *   { "model": "...", "max_tokens": 4000, "system": "...", "messages": [...] }
 */
function doPost(e) {
  var apiKey = PropertiesService.getScriptProperties().getProperty("ANTHROPIC_API_KEY");
  if (!apiKey) {
    return jsonOutput({
      error: { message: "サーバー側にANTHROPIC_API_KEYが設定されていません。スクリプトプロパティを確認してください。" }
    }, 500);
  }

  var requestBody;
  try {
    requestBody = JSON.parse(e.postData.contents);
  } catch (parseErr) {
    return jsonOutput({ error: { message: "リクエストボディをJSONとして解釈できませんでした。" } }, 400);
  }

  var payload = {
    model: requestBody.model || "claude-sonnet-4-6",
    max_tokens: requestBody.max_tokens || 4000,
    system: requestBody.system || "",
    messages: requestBody.messages || []
  };

  var options = {
    method: "post",
    contentType: "application/json",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  var response;
  try {
    response = UrlFetchApp.fetch(ANTHROPIC_MESSAGES_URL, options);
  } catch (fetchErr) {
    return jsonOutput({ error: { message: "Anthropic APIへの接続に失敗しました: " + fetchErr.message } }, 502);
  }

  // Anthropic APIからのレスポンス(成功・エラーとも)をそのまま返す。
  // ステータスコードもそのまま引き継ぐ。
  var output = ContentService.createTextOutput(response.getContentText());
  output.setMimeType(ContentService.MimeType.JSON);
  return output;
}

/**
 * JSONレスポンスを生成するヘルパー。
 * (GASのContentServiceはHTTPステータスコードを自由に設定できないため、
 *  ステータス相当の情報は本文のerrorオブジェクトで表現する)
 */
function jsonOutput(obj, statusHint) {
  if (statusHint) obj._status_hint = statusHint;
  var output = ContentService.createTextOutput(JSON.stringify(obj));
  output.setMimeType(ContentService.MimeType.JSON);
  return output;
}
