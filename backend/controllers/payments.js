const crypto = require('crypto');
const { PAYSTACK_BASE_URL, PAYSTACK_SECRET_KEY } = require('../config/paystack');
const mailSender = require('../utils/mailSender');
const { courseEnrollmentEmail } = require('../mail/templates/courseEnrollmentEmail');
require('dotenv').config();

const User = require('../models/user');
const Course = require('../models/course');
const CourseProgress = require("../models/courseProgress")

const { default: mongoose } = require('mongoose')


// ================ capture the payment and initiate a Paystack transaction ================
exports.capturePayment = async (req, res) => {

    // extract courseId & userId
    const { coursesId } = req.body;
    const userId = req.user.id;

    if (!coursesId || coursesId.length === 0) {
        return res.json({ success: false, message: "Please provide Course Id" });
    }

    let totalAmount = 0;

    for (const course_id of coursesId) {
        let course;
        try {
            // valid course Details
            course = await Course.findById(course_id);
            if (!course) {
                return res.status(404).json({ success: false, message: "Could not find the course" });
            }

            // check user already enrolled the course
            const uid = new mongoose.Types.ObjectId(userId);
            if (course.studentsEnrolled.includes(uid)) {
                return res.status(400).json({ success: false, message: "Student is already Enrolled" });
            }

            totalAmount += course.price;
        }
        catch (error) {
            console.log(error);
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    try {
        // Paystack needs the paying user's email
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ success: false, message: "User not found" });
        }

        // Paystack amounts are in the lowest currency subunit (cents for KES)
        const reference = `${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;

        const paystackResponse = await fetch(`${PAYSTACK_BASE_URL}/transaction/initialize`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                email: user.email,
                amount: Math.round(totalAmount * 100),
                currency: 'KES',
                reference,
                metadata: { coursesId, userId },
            }),
        });

        const paystackData = await paystackResponse.json();

        if (!paystackResponse.ok || !paystackData.status) {
            return res.status(500).json({ success: false, message: paystackData.message || "Could not initiate payment" });
        }

        // return response - shaped for the frontend to open Paystack's inline widget
        res.status(200).json({
            success: true,
            data: {
                authorization_url: paystackData.data.authorization_url,
                access_code: paystackData.data.access_code,
                reference: paystackData.data.reference,
                amount: Math.round(totalAmount * 100),
                currency: 'KES',
                email: user.email,
            },
        })
    }
    catch (error) {
        console.log(error);
        return res.status(500).json({ success: false, message: "Could not Initiate Order" });
    }

}



// ================ verify the payment ================
exports.verifyPayment = async (req, res) => {
    const reference = req.body?.reference;
    const courses = req.body?.coursesId;
    const userId = req.user.id;

    if (!reference || !courses || !userId) {
        return res.status(400).json({ success: false, message: "Payment Failed, data not found" });
    }

    try {
        const verifyResponse = await fetch(`${PAYSTACK_BASE_URL}/transaction/verify/${encodeURIComponent(reference)}`, {
            headers: {
                Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
            },
        });

        const verifyData = await verifyResponse.json();

        if (verifyResponse.ok && verifyData.status && verifyData.data?.status === 'success') {
            // enroll student
            await enrollStudents(courses, userId, res);
            // return res
            return res.status(200).json({ success: true, message: "Payment Verified" });
        }

        return res.status(200).json({ success: false, message: "Payment Failed" });
    }
    catch (error) {
        console.log(error);
        return res.status(500).json({ success: false, message: "Could not verify payment" });
    }
}


// ================ enroll Students to course after payment ================
const enrollStudents = async (courses, userId, res) => {

    if (!courses || !userId) {
        return res.status(400).json({ success: false, message: "Please Provide data for Courses or UserId" });
    }

    for (const courseId of courses) {
        try {
            //find the course and enroll the student in it
            const enrolledCourse = await Course.findOneAndUpdate(
                { _id: courseId },
                { $push: { studentsEnrolled: userId } },
                { new: true },
            )

            if (!enrolledCourse) {
                return res.status(500).json({ success: false, message: "Course not Found" });
            }

            // Initialize course preogres with 0 percent
            const courseProgress = await CourseProgress.create({
                courseID: courseId,
                userId: userId,
                completedVideos: [],
            })

            // Find the student and add the course to their list of enrolled courses
            const enrolledStudent = await User.findByIdAndUpdate(
                userId,
                {
                    $push: {
                        courses: courseId,
                        courseProgress: courseProgress._id,
                    },
                },
                { new: true }
            )

            // Send an email notification to the enrolled student
            await mailSender(
                enrolledStudent.email,
                `Successfully Enrolled into ${enrolledCourse.courseName}`,
                courseEnrollmentEmail(enrolledCourse.courseName, `${enrolledStudent.firstName}`)
            )
        }
        catch (error) {
            console.log(error);
            return res.status(500).json({ success: false, message: error.message });
        }
    }

}



// ================ send payment success email ================
exports.sendPaymentSuccessEmail = async (req, res) => {
    const { reference, amount } = req.body;

    const userId = req.user.id;

    if (!reference || !amount || !userId) {
        return res.status(400).json({ success: false, message: "Please provide all the fields" });
    }

    try {
        // find student
        const enrolledStudent = await User.findById(userId);

        const html = `
            <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
                <h2>Payment Received</h2>
                <p>Hi ${enrolledStudent.firstName},</p>
                <p>We've received your payment of <strong>KES ${(amount / 100).toFixed(2)}</strong>.</p>
                <p>Reference: ${reference}</p>
                <p>Thank you for learning with us!</p>
            </div>
        `;

        await mailSender(
            enrolledStudent.email,
            `Payment Received`,
            html
        )
        return res.status(200).json({ success: true, message: "Email sent" });
    }
    catch (error) {
        console.log("error in sending mail", error)
        return res.status(500).json({ success: false, message: "Could not send email" })
    }
}
