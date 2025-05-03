document.addEventListener("DOMContentLoaded", () => {
    const openPopupBtn = document.getElementById("open-popup-btn");
    const closePopupBtn = document.getElementById("close-popup-btn");
    const paymentPopup = document.getElementById("payment-popup");
    const valueButtons = document.querySelectorAll(".value-button");
    const qrCodeSection = document.getElementById("qrcode-section");
    const qrCodeContainer = document.getElementById("qrcode-container");
    const paymentStatus = document.getElementById("payment-status");

    const apiKey = "26636|WaieabI4aZ94FerRjym8dY5ytdwXtQqDgEmsyPB4e3b380a0"; // Chave fornecida
    const apiBaseUrl = "https://api.pushinpay.com.br/api"; // URL base da API

    let selectedValue = null;
    let currentTransactionId = null;
    let paymentCheckInterval = null;
    let telegramUrl = null; // Será solicitada ao usuário depois

    // --- Popup Handling ---
    function openPopup() {
        paymentPopup.style.display = "flex";
        setTimeout(() => paymentPopup.classList.add("active"), 10); // Delay for transition
    }

    function closePopup() {
        paymentPopup.classList.remove("active");
        setTimeout(() => {
            paymentPopup.style.display = "none";
            resetPopupState(); // Reset state when closing
        }, 300); // Match CSS transition duration
    }

    function resetPopupState() {
        selectedValue = null;
        currentTransactionId = null;
        qrCodeSection.style.display = "none";
        qrCodeContainer.innerHTML = "<p>Carregando QR Code...</p>";
        paymentStatus.textContent = "Status: Aguardando seleção de valor.";
        paymentStatus.className = ""; // Reset class
        valueButtons.forEach(btn => btn.classList.remove("selected"));
        if (paymentCheckInterval) {
            clearInterval(paymentCheckInterval);
            paymentCheckInterval = null;
        }
    }

    openPopupBtn.addEventListener("click", openPopup);
    closePopupBtn.addEventListener("click", closePopup);
    paymentPopup.addEventListener("click", (event) => {
        // Close if clicked outside the content area
        if (event.target === paymentPopup) {
            closePopup();
        }
    });

    // --- Value Selection Handling ---
    valueButtons.forEach(button => {
        button.addEventListener("click", () => {
            // Remove selection from others
            valueButtons.forEach(btn => btn.classList.remove("selected"));
            // Select current
            button.classList.add("selected");
            selectedValue = parseInt(button.getAttribute("data-value"));

            // Show QR section and generate QR code
            qrCodeSection.style.display = "block";
            generatePixQrCode(selectedValue);
        });
    });

    // --- Pushinpay API Integration ---
    async function generatePixQrCode(valueInCents) {
        qrCodeContainer.innerHTML = "<p>Gerando QR Code PIX...</p>";
        paymentStatus.textContent = "Status: Processando...";
        paymentStatus.className = "";
        currentTransactionId = null; // Reset transaction ID
        if (paymentCheckInterval) clearInterval(paymentCheckInterval); // Clear previous interval

        try {
            const response = await fetch(`${apiBaseUrl}/pix/cashIn`, {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${apiKey}`,
                    "Content-Type": "application/json",
                    "Accept": "application/json"
                },
                body: JSON.stringify({
                    value: valueInCents,
                    // webhook_url: "URL_DO_SEU_WEBHOOK" // Opcional
                })
            });

            if (!response.ok) {
                let errorText = `Erro HTTP: ${response.status}`;
                try {
                    const errorData = await response.json();
                    errorText += ` - ${JSON.stringify(errorData)}`;
                } catch (e) {
                    try {
                       errorText += ` - ${await response.text()}`;
                    } catch (e2) {}
                }
                throw new Error(errorText);
            }

            const data = await response.json();

            if (data.qr_code_base64 && data.id) {
                qrCodeContainer.innerHTML = `<img src="${data.qr_code_base64}" alt="PIX QR Code">`;
                paymentStatus.textContent = "Status: QR Code gerado. Aguardando pagamento.";
                currentTransactionId = data.id;
                // Start checking payment status
                startPaymentCheck(currentTransactionId);
            } else {
                throw new Error("Resposta da API inválida (sem QR Code ou ID).");
            }

        } catch (error) {
            console.error("Erro ao gerar QR Code PIX:", error);
            qrCodeContainer.innerHTML = "<p>Erro ao gerar QR Code. Tente selecionar novamente.</p>";
            paymentStatus.textContent = `Status: Erro - ${error.message}`;
            paymentStatus.className = "error";
        }
    }

    // --- Payment Status Check & Redirect ---
    async function checkPaymentStatus(transactionId) {
        if (!transactionId) return;

        console.log(`Verificando status da transação: ${transactionId}`); // Log para debug

        try {
            const response = await fetch(`${apiBaseUrl}/transactions/${transactionId}`, {
                method: "GET",
                headers: {
                    "Authorization": `Bearer ${apiKey}`,
                    "Accept": "application/json"
                }
            });

            if (!response.ok) {
                // Handle non-critical errors (e.g., temporary network issue) silently for polling
                console.error(`Erro ao verificar status (${response.status})`);
                return; // Continue polling
            }

            const data = await response.json();

            if (data.status === "paid") {
                console.log("Pagamento confirmado!");
                paymentStatus.textContent = "Status: Pagamento Confirmado! Redirecionando...";
                paymentStatus.className = "paid";
                clearInterval(paymentCheckInterval); // Stop polling
                paymentCheckInterval = null;

                // **Ação pós-pagamento: Redirecionar para Telegram**
                if (telegramUrl) {
                    window.location.href = telegramUrl;
                } else {
                    // Se a URL não foi fornecida ainda, apenas informa no console/popup
                    paymentStatus.textContent = "Status: Pagamento Confirmado! URL do Telegram não configurada.";
                    console.warn("URL do Telegram não definida para redirecionamento.");
                    // Poderia mostrar uma mensagem no popup pedindo para contatar suporte, etc.
                }

            } else if (data.status === "expired" || data.status === "failed" || data.status === "refunded") {
                console.log(`Transação ${transactionId} expirou/falhou/estornada.`);
                paymentStatus.textContent = `Status: Pagamento ${data.status}. Gere um novo QR Code.`;
                paymentStatus.className = "error";
                clearInterval(paymentCheckInterval);
                paymentCheckInterval = null;
            } else {
                // Status: created, pending, processing etc. - Continue polling
                paymentStatus.textContent = `Status: ${data.status || 'Verificando...'}`;
            }

        } catch (error) {
            console.error("Erro na verificação de status:", error);
            // Don't stop polling on network errors, maybe log differently
        }
    }

    function startPaymentCheck(transactionId) {
        if (paymentCheckInterval) clearInterval(paymentCheckInterval); // Clear existing interval

        // Check immediately first
        checkPaymentStatus(transactionId);

        // Then check every 10 seconds (adjust as needed)
        paymentCheckInterval = setInterval(() => {
            checkPaymentStatus(transactionId);
        }, 10000); // 10 segundos
    }

    // --- Placeholder for Telegram URL (Solicitar ao usuário depois) ---
        telegramUrl = "https://t.me/+buBXBAdkP5c2ZGYx"; // URL fornecida pelo usuário

});

