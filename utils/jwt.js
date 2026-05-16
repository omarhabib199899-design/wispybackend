const jwt = require("jsonwebtoken");

exports.signAccessToken = (userId) =>
  jwt.sign({ id: userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE || "7d",
  });

exports.signRefreshToken = (userId) =>
  jwt.sign({ id: userId }, process.env.JWT_REFRESH_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRE || "30d",
  });

exports.verifyAccessToken = (token) =>
  jwt.verify(token, process.env.JWT_SECRET);

exports.verifyRefreshToken = (token) =>
  jwt.verify(token, process.env.JWT_REFRESH_SECRET);

// Send token response with cookie
exports.sendTokenResponse = (user, statusCode, res) => {
  const accessToken = exports.signAccessToken(user._id);
  const refreshToken = exports.signRefreshToken(user._id);

  const cookieOptions = {
    expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
  };

  res
    .status(statusCode)
    .cookie("refreshToken", refreshToken, cookieOptions)
    .json({
      success: true,
      accessToken,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        plan: user.plan,
        planStatus: user.planStatus,
        isEmailVerified: user.isEmailVerified,
        role: user.role,
        trialEndsAt: user.trialEndsAt,
        company: user.company,
        avatarUrl: user.avatarUrl,
      },
    });
};
