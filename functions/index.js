const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { GoogleGenAI } = require('@google/genai');

// 🚨 【重要】paramsモジュールを追加し、環境変数を定義します 🚨
const { defineString } = require('firebase-functions/params');


// =======================================================
// A. サービスの初期化
// =======================================================

// 環境変数を定義
const GEMINI_API_KEY = defineString('GEMINI_API_KEY');

// Firebase Admin SDKの初期化
admin.initializeApp();
const db = admin.firestore();

// Gemini APIの初期化
// .value() を使って定義された環境変数を取得します
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY.value() });
const model = "gemini-2.5-flash";

// =======================================================
// B. ヘルパー関数 (RAGのためのデータ取得)
// =======================================================

/**
 * Firestoreから特定の利用者の基本情報、記録、予定を取得し、テキストにまとめる
 * @param {string} clientId - 利用者ID
 * @returns {Promise<string>} 取得したデータを整形したテキスト
 */
async function getClientContext(clientId) {
    const contextParts = [];

    // 1. 基本情報の取得 (clients/{clientId})
    const clientDoc = await db.collection('clients').doc(clientId).get();
    if (!clientDoc.exists) {
        return `エラー: 利用者ID ${clientId} は登録されていません。`;
    }
    const data = clientDoc.data();
    
    // 基本情報の整形
    contextParts.push(`--- 利用者基本情報 (ID: ${clientId}) ---`);
    contextParts.push(`氏名: ${data.client_name}`);
    contextParts.push(`担当CM: ${data.care_manager}`);
    contextParts.push(`連絡先: ${data.contact_tel}`);
    // 郵便番号を追加
    contextParts.push(`郵便番号: ${data.zipcode || '未登録'}`); 
    contextParts.push(`住所: ${data.address}`);
    
    // 2. 過去のケア記録の取得 (records サブコレクション)
    // care_date_time でソート
    const twoMonthsAgo = admin.firestore.Timestamp.fromDate(new Date(Date.now() - 60 * 24 * 60 * 60 * 1000));
    const recordsSnapshot = await clientDoc.ref.collection('records')
        .where('care_date_time', '>', twoMonthsAgo) 
        .orderBy('care_date_time', 'desc') 
        .limit(10) 
        .get();

    contextParts.push(`\n--- 最新のケア記録 (過去60日/最大10件) ---`);
    if (recordsSnapshot.empty) {
        contextParts.push("記録なし。");
    } else {
        recordsSnapshot.docs.forEach(doc => {
            const r = doc.data();
            const careTime = r.care_date_time 
                            ? r.care_date_time.toDate().toLocaleString('ja-JP')
                            : (r.record_time ? r.record_time.toDate().toLocaleString('ja-JP') + ' (登録日時)' : '日時不明');
            
            contextParts.push(`[${careTime} / 記録者:${r.staff_name}] ${r.care_content}`);
        });
    }

    // 3. 未来のサービス予定の取得 (schedules サブコレクション)
    const schedulesSnapshot = await clientDoc.ref.collection('schedules')
        .where('scheduled_time', '>', admin.firestore.Timestamp.fromDate(new Date()))
        .orderBy('scheduled_time', 'asc')
        .limit(5) 
        .get();

    contextParts.push(`\n--- 直近のサービス予定 (5件) ---`);
    if (schedulesSnapshot.empty) {
        contextParts.push("予定なし。");
    } else {
        schedulesSnapshot.docs.forEach(doc => {
            const s = doc.data();
            const time = s.scheduled_time.toDate().toLocaleString('ja-JP');
            contextParts.push(`[${time} / 担当者:${s.staff_in_charge}] 内容: ${s.service_details}`);
        });
    }

    return contextParts.join('\n');
}

// =======================================================
// C. HTTP Functionsのエンドポイント (修正済み)
// =======================================================

/**
 * 質問を受けてGeminiで推論し、回答を返す (一般質問/RAG実行)
 * URL: .../generalQuery
 */
exports.generalQuery = functions.https.onRequest(async (req, res) => {
    // CORSとメソッドチェック
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
    if (req.method !== 'POST') { res.status(405).send({ error: 'Method Not Allowed. Use POST.' }); return; }

    try {
        const body = req.body;
        const userQuestion = body.question;
        // 🚨 フロントエンドから送られたclientIdとsystemPromptを取得
        const clientId = body.clientId; 
        const customSystemPrompt = body.systemPrompt; 
        
        // 2. RAGコンテキストの取得
        let context = '';
        if (clientId) {
            // 利用者IDが指定された場合のみ、FirestoreからRAGデータを取得
            context = await getClientContext(clientId);
            
            if (context.startsWith('エラー')) {
                 return res.status(404).json({ answer: context });
            }
        } else {
            // 🚨 修正点: 利用者IDがない場合、エラーにせず、一般的な質問としてコンテキストを設定
            context = '利用者の特定情報は指定されていません。一般的な介護知識、または提供されたデータ全体から推論して回答してください。';
        }

        // 3. Geminiへのプロンプト構築
        // 🚨 修正点: フロントエンドから渡されたプロンプトをSystem Instructionとして使用
        const systemInstruction = customSystemPrompt || "あなたは介護現場のサポートAIです。質問に簡潔かつ正確に回答してください。";
        
        // プロンプトにコンテキストと質問を結合
        const fullPrompt = `${systemInstruction}\n\n[コンテキストデータ]\n${context}\n\n[ユーザーの質問]\n${userQuestion}`;

        // 4. Gemini APIの呼び出し
        const response = await ai.models.generateContent({
            model: model,
            contents: fullPrompt,
        });

        const answer = response.text;

        // 5. 成功時のレスポンス
        res.status(200).json({ answer: answer });

    } catch (error) {
        console.error("GENERAL_QUERY_ERROR:", error);
        res.status(500).json({ error: 'サーバー処理中にエラーが発生しました。ログを確認してください。' });
    }
});


/**
 * ログインユーザーの本日の予定を返す (機能⑦)
 * URL: .../scheduleQuery
 */
exports.scheduleQuery = functions.https.onRequest(async (req, res) => {
    // CORSとメソッドチェック
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
    if (req.method !== 'POST') { res.status(405).send({ error: 'Method Not Allowed. Use POST.' }); return; }

    try {
        const body = req.body;
        const currentUser = body.currentUser; // ログインユーザー名 (担当スタッフ)
        
        if (!currentUser) {
            return res.status(400).json({ answer: 'ログインユーザー名が特定できません。' });
        }

        // 今日の日時範囲を設定
        const now = new Date();
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
        const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

        // 1. Collection Group Queryで全利用者の予定を横断検索
        // 🚨 注意: Firestoreコンソールで 'schedules' に対する Collection Group Index を作成する必要があります。
        const scheduleSnapshot = await db.collectionGroup('schedules')
            .where('staff_in_charge', '==', currentUser)
            .where('scheduled_time', '>=', startOfDay)
            .where('scheduled_time', '<=', endOfDay)
            .orderBy('scheduled_time', 'asc')
            .get();

        const scheduleList = [];
        scheduleSnapshot.docs.forEach(doc => {
            const data = doc.data();
            const clientRef = doc.ref.parent.parent; // clients/{clientId} のドキュメント参照を取得
            
            scheduleList.push({
                clientId: clientRef.id, // 利用者ID
                time: data.scheduled_time.toDate().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }),
                details: data.service_details
            });
        });

        // 2. Geminiへのプロンプト構築と呼び出し
        let promptText = `あなたは介護スタッフのサポートAIです。以下の[本日のあなたの担当予定]を、分かりやすいリスト形式で整理して回答してください。\n`;
        
        if (scheduleList.length === 0) {
            promptText += `[本日のあなたの担当予定]: 本日、${currentUser}さんの予定はありません。`;
        } else {
            promptText += `[本日のあなたの担当予定] (${currentUser}様):\n`;
            scheduleList.forEach(s => {
                promptText += `- ${s.time} (利用者ID: ${s.clientId}): ${s.details}\n`;
            });
        }
        
        const response = await ai.models.generateContent({
            model: model,
            contents: promptText,
        });

        res.status(200).json({ answer: response.text });

    } catch (error) {
        console.error("SCHEDULE_QUERY_ERROR:", error);
        res.status(500).json({ error: '予定取得処理中にエラーが発生しました。ログを確認してください。' });
    }
});