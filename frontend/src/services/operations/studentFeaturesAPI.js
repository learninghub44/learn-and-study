import { toast } from "react-hot-toast";
import { studentEndpoints } from "../apis";
import { apiConnector } from "../apiConnector";
import { setPaymentLoading } from "../../slices/courseSlice";
import { resetCart } from "../../slices/cartSlice";


const { COURSE_PAYMENT_API, COURSE_VERIFY_API, SEND_PAYMENT_SUCCESS_EMAIL_API } = studentEndpoints;

function loadScript(src) {
    return new Promise((resolve) => {
        const script = document.createElement("script");
        script.src = src;

        script.onload = () => {
            resolve(true);
        }
        script.onerror = () => {
            resolve(false);
        }
        document.body.appendChild(script);
    })
}

// ================ buyCourse ================
export async function buyCourse(token, coursesId, userDetails, navigate, dispatch) {
    const toastId = toast.loading("Loading...");

    try {
        //load the Paystack inline script
        const res = await loadScript("https://js.paystack.co/v1/inline.js");

        if (!res) {
            toast.error("Paystack SDK failed to load");
            return;
        }

        // initiate the transaction (backend creates it via Paystack's API)
        const orderResponse = await apiConnector("POST", COURSE_PAYMENT_API,
            { coursesId },
            {
                Authorization: `Bearer ${token}`,
            })
        if (!orderResponse.data.success) {
            throw new Error(orderResponse.data.message);
        }

        const { amount, currency, reference, email } = orderResponse.data.data;
        const PAYSTACK_PUBLIC_KEY = import.meta.env.VITE_APP_PAYSTACK_PUBLIC_KEY;

        const handler = window.PaystackPop.setup({
            key: PAYSTACK_PUBLIC_KEY,
            email,
            amount,
            currency,
            ref: reference,
            callback: function (response) {
                //send successful mail
                sendPaymentSuccessEmail(response, amount, token);
                //verifyPayment
                verifyPayment({ reference: response.reference, coursesId }, token, navigate, dispatch);
            },
            onClose: function () {
                toast.error("Payment window closed");
            },
        });

        handler.openIframe();

    }
    catch (error) {
        console.log("PAYMENT API ERROR.....", error);
        toast.error(error.response?.data?.message);
    }
    toast.dismiss(toastId);
}


// ================ send Payment Success Email ================
async function sendPaymentSuccessEmail(response, amount, token) {
    try {
        await apiConnector("POST", SEND_PAYMENT_SUCCESS_EMAIL_API, {
            reference: response.reference,
            amount,
        }, {
            Authorization: `Bearer ${token}`
        })
    }
    catch (error) {
        console.log("PAYMENT SUCCESS EMAIL ERROR....", error);
    }
}


// ================ verify payment ================
async function verifyPayment(bodyData, token, navigate, dispatch) {
    const toastId = toast.loading("Verifying Payment....");
    dispatch(setPaymentLoading(true));

    try {
        const response = await apiConnector("POST", COURSE_VERIFY_API, bodyData, {
            Authorization: `Bearer ${token}`,
        })

        if (!response.data.success) {
            throw new Error(response.data.message);
        }
        toast.success("payment Successful, you are addded to the course");
        navigate("/dashboard/enrolled-courses");
        dispatch(resetCart());
    }
    catch (error) {
        console.log("PAYMENT VERIFY ERROR....", error);
        toast.error("Could not verify Payment");
    }
    toast.dismiss(toastId);
    dispatch(setPaymentLoading(false));
}
