// =======================================================
// A. Firebase SDKのインポートと初期化設定 (V9 モジュール構文)
// =======================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-app.js";
import { 
    getFirestore, 
    doc,
    getDoc,
    setDoc,
    collection,
    addDoc,
    Timestamp, // V9のTimestampクラスを直接インポート
    query,
    where,
    getDocs,
    orderBy, // 検索結果のソートに使用
    // ... 他の必要な関数 ...
} from "https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js";

// Firebaseの設定 
const firebaseConfig = {
    authDomain: "kadai05-api-9c95b.firebaseapp.com",
    projectId: "kadai05-api-9c95b",
    storageBucket: "kadai05-api-9c95b.firebasestorage.app",
    messagingSenderId: "362459554836",
    appId: "1:362459554836:web:9d3ee0bd5bea0f23fb7301"
};

// V9初期化とFirestoreインスタンスの取得
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// AIのペルソナ、応答ルールを設定するプロンプト
const SYSTEM_PROMPT = [
    "あなたはベテランのケアマネジャー兼訪問介護スタッフ管理者です。",
    "聞かれた質問について、あなたが過去に経験したデータや記録に基づいて専門的に回答してください。",
    "ただし、回答する際は以下のルールを厳守してください:",
    "1. 回答は簡潔に要約し、**重要な区切りでのみ**改行（HTMLの<br>タグ）やリスト（<ul><li>など）を使って、読みやすい文章構造に整形してください。**過度な改行は避けてください。**", 
    "2. 質問文に「どうしたらいいですか？」というフレーズが含まれている場合のみ、長年の経験から特に注意する点や、他のスタッフへの申し送りとして伝達した方が良い点を必ず含めて回答してください。それ以外の質問では、注意点や申し送りは不要です。",
    "3. 介護スタッフを個人的に応援するメッセージは含めないでください。"
].join('\n');

// =======================================================
// B. ユーティリティ関数
// =======================================================

/*
 * ログインユーザー名を取得 (今はひとりだけ変更不可)
 */
function getCurrentUserName() {
    return "山田太郎"; 
}

/*
 * HTMLのdate/time入力からFirestore用のTimestampを作成 (V9対応)
 */
function combineDateTimeToTimestamp(dateStr, timeStr) {
    if (!dateStr || !timeStr) return null;
    const [year, month, day] = dateStr.split('-').map(Number);
    const [hours, minutes] = timeStr.split(':').map(Number);
    const dateObj = new Date(year, month - 1, day, hours, minutes);
    
    if (isNaN(dateObj.getTime())) return null;
    // V9対応: インポートしたTimestampクラスを直接使用
    return Timestamp.fromDate(dateObj); 
}

/*
 * チャットウィンドウにメッセージを追加する
 */
function appendMessage(sender, message) {
    const chatWindow = $('#chat-window');
    const messageClass = sender === 'user' ? 'user-message' 
                         : sender === 'ai' ? 'ai-message' 
                         : 'system-message'; 
                             
    let messageHtml = '';

    if (sender === 'ai') {
        // AIメッセージの表示とアイコン
        messageHtml = `
            <div class="${messageClass}" style="display: flex; align-items: flex-start; gap: 5px;margin-bottom: 0px;"> 
                <img src="./images/AI.gif" alt="AIアイコン" style="height: 20px; width: 20px; flex-shrink: 0;">
                <span style="color: #007bff; font-weight: bold; flex-shrink: 0;"></span>
                <span style="white-space: pre-wrap; color: #0056b3;">${message}</span>
            </div>
        `;
    } else if (sender === 'user') {
        // ユーザーメッセージ画像を表示
        messageHtml = `
            <div class="${messageClass}" style="display: flex; align-items: center; gap: 5px; margin-bottom: 5px;">
                <img src="./images/q.png" alt="ユーザーアイコン" style="height: 20px; width: 20px; flex-shrink: 0;">
                <span style="white-space: pre-wrap; color: #333;">${message}</span>
            </div>
        `;
        
    } else {
        // systemメッセージ
        messageHtml = `<div class="${messageClass}" style="margin-bottom: 5px;">${message}</div>`;
    }
                             
    chatWindow.append(messageHtml);
    // 画面下の自動スクロール
    chatWindow.scrollTop(chatWindow[0].scrollHeight);
    
    if (sender === 'user') {
        $('#user-input').val('');
    }
}

/*
 * 利用者マスター登録フォームの入力フィールドをクリアする
 */
function clearClientFormFields() {
    $('#reg-client-name').val('');
    $('#reg-zipcode').val(''); 
    $('#reg-address').val('');
    $('#reg-contact-name').val('');
    $('#reg-contact-tel').val('');
    $('#reg-care-manager').val('');
    $('#client-submit-button').text('利用者基本情報を登録');
}

/*
 * 取得した利用者データをフォームに反映し、編集可能にする
 */
function populateClientForm(data) {
    $('#reg-client-name').val(data.client_name || '');
    $('#reg-zipcode').val(data.zipcode || ''); 
    $('#reg-address').val(data.address || '');
    $('#reg-contact-name').val(data.contact_name || '');
    $('#reg-contact-tel').val(data.contact_tel || '');
    $('#reg-care-manager').val(data.care_manager || '');
    
    const clientId = $('#reg-client-id').val();
    $('#client-submit-button').text(`ID: ${clientId} の情報を更新`);
    alert(`利用者ID: ${clientId} の情報を取得しました。編集後「更新」を押してください。`);
}

/*
 * Firestoreから利用者データを取得し、セレクトボックスに反映する
 */
async function fetchClientsForSelect(targetSelectId = '#client-select') {
    const clientSelect = $(targetSelectId);
    clientSelect.empty();
    
    if (targetSelectId === '#client-select') {
        clientSelect.append('<option value="" data-name="">利用者を選択してください</option>');
    } else if (targetSelectId === '#record-client-select') {
        clientSelect.append('<option value="" disabled selected>利用者を選択してください</option>');
    }
    
    try {
        const clientsCollectionRef = collection(db, 'clients');
        const q = query(clientsCollectionRef);
        const querySnapshot = await getDocs(q);
        
        querySnapshot.forEach((docSnap) => {
            const data = docSnap.data();
            const clientId = docSnap.id;
            const clientName = data.client_name || '(氏名なし)';
            
            clientSelect.append(`<option value="${clientId}" data-name="${clientName}">${clientId}: ${clientName}</option>`);
        });
        
    } catch (error) {
        console.error("利用者リストの取得エラー:", error);
        appendMessage('system', '利用者リストの取得に失敗しました。');
    }
}

/*
 * 郵便番号検索API (zipcloud) を利用して住所を取得し、フォームに反映する (AXIOS使用)
 */
async function searchAddressByZipcode() {
    const zipcode = $('#reg-zipcode').val().trim();
    const addressField = $('#reg-address');

    if (zipcode.length !== 7 || !/^[0-9]+$/.test(zipcode)) {
        alert("郵便番号はハイフンなしの7桁の数字で入力してください。");
        return;
    }

    try {
        const apiUrl = `https://zipcloud.ibsnet.co.jp/api/search?zipcode=${zipcode}`;
        
        // 🚨 AXIOSを使用
        const response = await axios.get(apiUrl);
        const data = response.data; // AXIOSは自動でJSONを response.data に格納

        if (data.status === 200 && data.results) {
            const result = data.results[0];
            const address = result.address1 + result.address2 + result.address3;
            
            addressField.val(address);
            addressField.focus(); 
            alert(`住所が自動入力されました: ${address}`);
        } else if (data.status === 400 || !data.results) {
            alert("該当する郵便番号が見つかりませんでした。入力内容を確認してください。");
            addressField.val('');
        } else {
            throw new Error(`APIエラー: ${data.message || '不明なエラー'}`);
        }

    } catch (error) {
        // AXIOSはHTTPエラーもここで捕捉する
        console.error("郵便番号検索エラー:", error);
        
        let errorMessage = "郵便番号検索中にシステムエラーが発生しました。";
        if (error.response) {
            errorMessage = `サーバーエラーが発生しました (ステータス: ${error.response.status})。`;
        }
        
        alert(errorMessage);
    }
}

/*
 * 選択した利用者に紐づくケア記録を全て取得して表示する
 */
async function getClientRecordsData(clientId) {
    try {
        const recordsCollectionRef = collection(db, 'clients', clientId, 'records');
        // care_date_time (ケア実施日時) で降順ソート
        const q = query(recordsCollectionRef, orderBy('care_date_time', 'desc'));
        const querySnapshot = await getDocs(q);

        const records = [];
        querySnapshot.forEach(docSnap => {
            const data = docSnap.data();
            records.push({
                id: docSnap.id,
                care_date_time: data.care_date_time ? data.care_date_time.toDate() : null,
                care_content: data.care_content,
                staff_name: data.staff_name,
            });
        });
        return records;

    } catch (error) {
        console.error(`ケア記録取得エラー (ID: ${clientId}):`, error);
        return [];
    }
}


// =======================================================
// C. メイン処理 (DOMContentLoaded / jQuery ready)
// =======================================================

$(document).ready(function() {
    
    // 初回実行: 利用者選択リストをロード
    fetchClientsForSelect('#client-select');
    fetchClientsForSelect('#record-client-select'); // ケア記録フォーム用リスト
    
    // --- C-1. 音声入力機能の初期設定 ---
    const $micButton = $('#mic-button');
    const $userInput = $('#user-input');
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (SpeechRecognition) {
        const recognition = new SpeechRecognition();
        recognition.lang = 'ja-JP';
        recognition.interimResults = false;
        recognition.continuous = false;

        $micButton.on('click', function() {
            try {
                recognition.start();
                $micButton.prop('disabled', true).html('🔴'); 
                appendMessage('system', 'マイク入力中です。話し終えると自動で停止します。');
            } catch (error) {
                console.error("音声認識の起動エラー:", error);
            }
        });

        recognition.onresult = function(event) {
            const transcript = event.results[0][0].transcript;
            $userInput.val(transcript);
            appendMessage('system', `入力完了: ${transcript}`);
            
            if (transcript.trim() !== '') {
                $('#chat-form').submit(); 
            }
        };

        recognition.onend = function() {
            $micButton.prop('disabled', false).html('<img src="./images/mic.png" style="font-size: 10px;">'); 
        };

        recognition.onerror = function(event) {
            console.error('音声認識エラー:', event.error);
            appendMessage('system', `音声認識に失敗しました。エラーコード: ${event.error}`);
            $micButton.prop('disabled', false).html('<img src="./images/mic.png" style="font-size: 10px;">');
        };

    } else {
        $micButton.hide();
        console.warn('Web Speech APIはサポートされていません。');
    }

    // --- C-2. チャットフォームのイベントハンドラ ---
    $('#chat-form').on('submit', function(e) {
        e.preventDefault();
        const question = $userInput.val();
        
        const selectedOption = $('#client-select option:selected');
        const selectedClientId = selectedOption.val();
        const selectedClientName = selectedOption.data('name');
        
        const clientInfo = selectedClientId
            ? { id: selectedClientId, name: selectedClientName }
            : null;

        if (question.trim() !== '') {
            let displayQuestion = question;
            if(clientInfo) {
                displayQuestion = `[${clientInfo.name} (ID: ${clientInfo.id})] ${question}`;
            }
            appendMessage('user', displayQuestion);
            handleGeminiRequest(question, 'general_query', clientInfo); 
        }
    });
    
    // --- C-2.5. チャットクリアボタンのイベントハンドラ ---
    $('#clear-chat-button').on('click', function() {
        $('#chat-window').html(`
            <div class="ai-message" style="font-size:15px; font-weight: bold; font-family: Impact, Haettenschweiler, 'Arial Narrow Bold', sans-serif; display: flex; align-items: center; gap: 5px;">
              <span style="color: #007bff;"></span> 
            </div>
        `);
        $('#user-input').val('');
        $('#client-select').val(''); 
        appendMessage('system', '');
    });

    // --- C-3. 今日の予定ボタンのイベントハンドラ ---
    $('#today-schedule-button').on('click', function() {
        const userName = getCurrentUserName();
        const question = `${userName}さんの本日の担当予定は何ですか？`;
        appendMessage('user', '今日の予定を確認しています...');
        handleGeminiRequest(question, 'today_schedule', null); 
    });

    // --- C-4. データ登録機能のイベントハンドラ ---
    
    // 郵便番号検索ボタンのイベントハンドラ (AXIOS使用)
    $('#search-zipcode').on('click', searchAddressByZipcode);
    
    // 1. 新規利用者登録フォームの処理 (clients コレクション)
    $('#client-register-form').on('submit', async function(e) {
        e.preventDefault();
        const clientId = $('#reg-client-id').val().trim();
        const clientName = $('#reg-client-name').val();
        const careManager = $('#reg-care-manager').val();
        const address = $('#reg-address').val();
        const contactName = $('#reg-contact-name').val();
        const contactTel = $('#reg-contact-tel').val();
        const zipcode = $('#reg-zipcode').val(); 
        
        if (!clientId) { return alert("利用者IDは必須です。入力してください。"); }
        
        try {
            await setDoc(doc(db, 'clients', clientId), {
                client_name: clientName,
                zipcode: zipcode, 
                address: address, 
                contact_name: contactName,
                contact_tel: contactTel,
                care_manager: careManager, 
                start_date: Timestamp.fromDate(new Date()),
            });
            alert(`利用者「${clientName}」の情報をID: ${clientId} で${$('#client-submit-button').text()}しました。`);
            
            clearClientFormFields(); 
            $('#reg-client-id').val('');
            
            fetchClientsForSelect('#client-select');
            fetchClientsForSelect('#record-client-select');
            
        } catch (error) {
            console.error("利用者登録/更新エラー:", error);
            alert("利用者登録/更新に失敗しました。コンソールを確認してください。");
        }
    });

    // 2. 利用者ID検索ボタンのイベントハンドラ (clients コレクション)
    $('#search-client-by-id').on('click', async function() {
        const clientId = $('#reg-client-id').val().trim();
        if (!clientId) { return alert("検索したい利用者IDを入力してください。"); }

        clearClientFormFields(); 
        $('#client-submit-button').text('検索中...');

        try {
            const docRef = doc(db, 'clients', clientId);
            const docSnap = await getDoc(docRef);

            if (docSnap.exists()) {
                const data = docSnap.data();
                populateClientForm(data);
                $('#reg-zipcode').val(data.zipcode || '');
                
            } else {
                alert(`利用者ID: ${clientId} は登録されていません。このIDで新規登録しますか？`);
                $('#client-submit-button').text('新規利用者として登録');
            }
        } catch (error) {
            console.error("利用者ID検索エラー:", error);
            alert("利用者ID検索中にエラーが発生しました。");
            $('#client-submit-button').text('利用者基本情報を登録'); 
        }
    });

    // 3. ケア記録追加フォームの処理 (records サブコレクション) 
    $('#record-add-form').on('submit', async function(e) {
        e.preventDefault();
        
        const clientId = $('#record-client-select').val(); 
        const dateStr = $('#record-date').val(); 
        const timeStr = $('#record-time').val(); 
        const careContent = $('#record-content').val();
        const staffName = getCurrentUserName(); 
        
        if (!clientId) {
            return alert("利用者を選択してください。");
        }
        
        const scheduledTimestamp = combineDateTimeToTimestamp(dateStr, timeStr);
        if (!scheduledTimestamp) {
            return alert("記録日時が正しく入力されていません。");
        }
        
        try {
            const recordsCollectionRef = collection(db, 'clients', clientId, 'records');
            await addDoc(recordsCollectionRef, {
                record_time: Timestamp.fromDate(new Date()), 
                care_date_time: scheduledTimestamp, 
                care_content: careContent, 
                staff_name: staffName
            });
            alert(`利用者ID: ${clientId} にケア記録を追加しました。`);
            this.reset();
        } catch (error) {
            console.error("ケア記録追加エラー:", error);
            alert("ケア記録の追加に失敗しました。利用者IDが正しいか確認してください。");
        }
    });


    // 4. サービス提供予定の追加 (schedules サブコレクション)
    $('#schedule-add-form').on('submit', async function(e) {
        e.preventDefault();
        const clientId = $('#schedule-client-id').val();
        const dateStr = $('#schedule-date').val();
        const timeStr = $('#schedule-time').val();
        const staffInCharge = $('#schedule-staff').val();
        const serviceDetails = $('#schedule-details').val();
        
        const scheduledTimestamp = combineDateTimeToTimestamp(dateStr, timeStr);
        if (!scheduledTimestamp) {
            return alert("予定日時が正しく入力されていません。");
        }

        try {
            const schedulesCollectionRef = collection(db, 'clients', clientId, 'schedules');
            await addDoc(schedulesCollectionRef, {
                scheduled_time: scheduledTimestamp,
                staff_in_charge: staffInCharge,
                service_details: serviceDetails
            });
            
            alert(`利用者ID: ${clientId} にサービス提供予定を追加しました。`);
            this.reset();
            
        } catch (error) {
            console.error("サービス予定追加エラー:", error);
            alert("サービス予定の追加に失敗しました。");
        }
    });
    
    // 5. 利用者検索・情報確認フォームのイベントハンドラ 
    $('#client-search-form').on('submit', async function(e) {
        e.preventDefault();
        
        const queryText = $('#search-query').val().trim();
        if (!queryText) return;

        $('#search-results-area').html('<p>検索中...</p>');
        
        try {
            const resultsArea = $('#search-results-area');
            resultsArea.empty();
            let found = false;
            let results = [];

            // 1. 利用者IDによる直接検索
            const idDocRef = doc(db, 'clients', queryText);
            const idDocSnap = await getDoc(idDocRef);

            if (idDocSnap.exists()) {
                results.push({ id: idDocSnap.id, data: idDocSnap.data() });
                found = true;
            }

            // 2. 利用者氏名による検索 (完全一致)
            const clientsCollectionRef = collection(db, 'clients');
            const nameQuery = query(clientsCollectionRef, where('client_name', '==', queryText));
            const nameQuerySnapshot = await getDocs(nameQuery);

            nameQuerySnapshot.forEach(docSnap => {
                if (docSnap.id !== queryText) { 
                    results.push({ id: docSnap.id, data: docSnap.data() });
                    found = true;
                }
            });

            if (found) {
                
                for (const { id, data } of results) {
                    // ケア記録の取得
                    const records = await getClientRecordsData(id);
                    
                    // ケア記録をHTMLに整形
                    let recordsHtml = '<h5 style="margin-top: 15px; border-bottom: 1px solid #ccc; padding-bottom: 5px;">📚 ケア記録一覧 (最新順)</h5>';
                    
                    if (records.length === 0) {
                        recordsHtml += '<p>記録はまだ登録されていません。</p>';
                    } else {
                        recordsHtml += '<ul style="list-style: none; padding-left: 0;">';
                        records.forEach(r => {
                            const timeStr = r.care_date_time ? r.care_date_time.toLocaleString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '日時不明';
                            
                            recordsHtml += `
                                <li style="border: 1px dashed #ddd; padding: 8px; margin-bottom: 5px;">
                                    <strong>[${timeStr}]</strong> (担当: ${r.staff_name})<br>
                                    ${r.care_content.substring(0, 150)}...
                                </li>
                            `;
                        });
                        recordsHtml += '</ul>';
                    }

                    // 基本情報とケア記録を結合して表示
                    resultsArea.append(`
                        <div style="border: 1px solid #007bff; padding: 10px; margin-bottom: 20px; background-color: #e9f5ff;">
                            <h4>👤 ${data.client_name} (ID: ${id})</h4>
                            <ul style="list-style: none; padding-left: 0; margin-bottom: 10px;">
                                <li><strong>担当ケアマネ:</strong> ${data.care_manager}</li>
                                <li><strong>郵便番号:</strong> ${data.zipcode || '未登録'}</li>
                                <li><strong>住 所:</strong> ${data.address}</li>
                                <li><strong>連絡先:</strong> ${data.contact_name} (${data.contact_tel})</li>
                                <li><strong>担当開始日:</strong> ${data.start_date.toDate().toLocaleDateString('ja-JP')}</li>
                            </ul>
                            ${recordsHtml}
                        </div>
                    `);
                }

            } else {
                resultsArea.html('<p style="color: red;">該当する利用者は見つかりませんでした。</p>');
            }

        } catch (error) {
            console.error("検索処理エラー:", error);
            $('#search-results-area').html('<p style="color: red;">検索中にシステムエラーが発生しました。</p>');
        }
    });
});


// =======================================================
// D. Gemini / Firebase Functions 連携関数 (RAG処理のトリガー)
// =======================================================

/**
 * 質問をサーバーに送り、Geminiの結果を取得する(AXIOS使用)
 * @param {string} userQuestion - ユーザーの質問
 * @param {string} type - 質問のタイプ ('general_query' or 'today_schedule')
 * @param {{id: string, name: string}|null} clientInfo - 選択された利用者情報
 */
async function handleGeminiRequest(userQuestion, type, clientInfo = null) {
    $('.ai-message:last').text('お待ちください・・・');

    // 【重要】Functions の URL はデプロイで得られたURLに置き換える
    const generalQueryUrl = 'https://generalquery-raopf6vcfa-uc.a.run.app'; 
    const scheduleQueryUrl = 'https://schedulequery-raopf6vcfa-uc.a.run.app';
    
    let apiUrl;
    
    if (type === 'today_schedule') {
        apiUrl = scheduleQueryUrl;
    } else {
        apiUrl = generalQueryUrl;
    }
        
    let finalQuestion = userQuestion;
    let clientId = null;
    let clientName = null;
    
    if (clientInfo) {
        clientId = clientInfo.id;
        clientName = clientInfo.name;
        finalQuestion = `[${clientId},： ${clientName}]様に関する質問ですね。${userQuestion}`;
    }
        
    try {
        const response = await axios.post(apiUrl, {
            // AXIOSはオブジェクトを自動でJSONに変換
            question: finalQuestion, 
            currentUser: getCurrentUserName(),
            clientId: clientId, 
            clientName: clientName, 
            systemPrompt: SYSTEM_PROMPT 
        });

        const result = response.data;

        // AXIOSはHTTP 2xx の場合のみ成功とみなすため、response.ok のチェックは不要だが、
        // result.answer の存在チェックは引き続き行う。
        if (result.answer) {
            $('.ai-message:last').remove();
            appendMessage('ai', result.answer); 
        } else {
            $('.ai-message:last').remove();
            appendMessage('ai', `回答生成中にエラーが発生しました。エラー: ${result.error || '不明なエラー'}`);
        }
        
        $('#chat-window').scrollTop($('#chat-window')[0].scrollHeight);

    } catch (error) {
        console.error("通信エラーまたはサーバーエラー:", error);
        
        let errorMessage = 'ネットワークエラーが発生しました。';
        
        if (error.response) {
            // サーバーからの応答があった場合 (4xx, 5xx)
            errorMessage = `サーバー応答エラー: ステータス ${error.response.status} (${error.response.data?.error || '詳細不明'})`;
        }
        
        $('.ai-message:last').remove();
        appendMessage('ai', errorMessage);
        $('#chat-window').scrollTop($('#chat-window')[0].scrollHeight);
    }
}