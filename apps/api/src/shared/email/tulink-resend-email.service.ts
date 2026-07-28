import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

export interface TuLinkEmailOptions {
  to: string | string[];
  subject: string;
  html: string;
  from?: string;
}

@Injectable()
export class TuLinkResendEmailService {
  private resend: Resend;
  private isConfigured: boolean = false;
  private defaultFrom: string;

  constructor(private configService: ConfigService) {
    this.initializeResend();
  }

  private initializeResend() {
    const apiKey = this.configService.get<string>('RESEND_API_KEY');
    this.defaultFrom = this.configService.get<string>(
      'RESEND_FROM_EMAIL',
      'TuLink <noreply@tulink.xyz>',
    );

    if (!apiKey) {
      console.warn(
        'Resend API key not configured. Email sending will be disabled.',
      );
      this.isConfigured = false;
      return;
    }

    try {
      this.resend = new Resend(apiKey);
      this.isConfigured = true;
      console.log('TuLink Resend email service initialized successfully');
    } catch (error) {
      console.error('Failed to initialize Resend:', error);
      this.isConfigured = false;
    }
  }

  async sendEmail(options: TuLinkEmailOptions): Promise<boolean> {
    if (!this.isConfigured) {
      console.log('Resend not configured. Would send email to:', options.to);
      console.log('Subject:', options.subject);
      return false;
    }

    try {
      const { data, error } = await this.resend.emails.send({
        from: options.from || this.defaultFrom,
        to: Array.isArray(options.to) ? options.to : [options.to],
        subject: options.subject,
        html: options.html,
      });

      if (error) {
        console.error('Resend email error:', error);
        return false;
      }

      console.log('TuLink email sent successfully via Resend:', data?.id);
      return true;
    } catch (error) {
      console.error('Failed to send TuLink email via Resend:', error);
      return false;
    }
  }

  async sendVerificationEmail(
    email: string,
    displayName: string,
    verificationLink: string,
  ): Promise<boolean> {
    const subject = 'Verify your Tulink account';
    const html = this.generateVerificationEmailHTML(
      displayName,
      verificationLink,
    );

    return this.sendEmail({
      to: email,
      subject,
      html,
      from: 'TuLink Mission Control <verify@tulink.xyz>',
    });
  }

  private generateVerificationEmailHTML(
    displayName: string,
    verificationLink: string,
  ): string {
    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Activate TuLink Mission Control</title>
          <style>
            body { 
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, system-ui, sans-serif; 
              line-height: 1.6; 
              margin: 0; 
              padding: 0; 
              background-color: #0D0D0D;
              color: #FFFFFF;
            }
            .container { 
              max-width: 600px; 
              margin: 0 auto; 
              background-color: #0D0D0D;
              border-radius: 8px;
              overflow: hidden;
              box-shadow: 0 4px 20px rgba(232, 0, 45, 0.15);
              border: 1px solid #333;
            }
            .logo-header {
              text-align: center;
              padding: 30px;
              background: radial-gradient(circle at center, rgba(232, 0, 45, 0.18) 0%, rgba(232, 0, 45, 0) 70%);
            }
            .logo-svg {
              width: 80px;
              height: 80px;
              margin: 0 auto 20px;
              filter: drop-shadow(0 4px 8px rgba(0, 0, 0, 0.3));
              display: block;
            }
            .logo-fallback {
              width: 80px;
              height: 80px;
              margin: 0 auto 20px;
              background: #E8002D;
              border-radius: 12px;
              display: flex;
              align-items: center;
              justify-content: center;
              position: relative;
              transform: perspective(300px) rotateX(5deg);
            }
            .logo-text {
              font-family: 'Bebas Neue', Impact, 'Arial Black', Arial, sans-serif;
              font-size: 28px;
              font-weight: 400;
              color: #FFFFFF;
              letter-spacing: 2px;
              margin: 0;
            }
            .brand-name {
              font-family: 'Bebas Neue', Impact, 'Arial Black', Arial, sans-serif;
              font-size: 32px;
              font-weight: 400;
              color: #FFFFFF;
              margin: 0 0 8px 0;
              letter-spacing: 3px;
            }
            .tagline {
              color: #E8002D;
              font-size: 14px;
              font-weight: 600;
              text-transform: uppercase;
              letter-spacing: 1px;
              margin: 0;
            }
            .header { 
              background: linear-gradient(135deg, #E8002D 0%, #B8001F 100%);
              color: white; 
              padding: 30px; 
              text-align: center;
              position: relative;
              overflow: hidden;
            }
            .header::before {
              content: '';
              position: absolute;
              top: 0;
              left: 0;
              right: 0;
              bottom: 0;
              background: linear-gradient(45deg, transparent 40%, rgba(255,255,255,0.1) 50%, transparent 60%);
              animation: shine 3s ease-in-out infinite;
            }
            @keyframes shine {
              0% { transform: translateX(-100%); }
              50% { transform: translateX(-100%); }
              100% { transform: translateX(100%); }
            }
            .header h1 { 
              margin: 0; 
              font-size: 24px; 
              font-weight: 700;
              text-shadow: 0 2px 4px rgba(0,0,0,0.3);
              position: relative;
              z-index: 1;
            }
            .content { 
              padding: 40px 30px; 
              background: #0D0D0D;
            }
            .content p {
              margin: 0 0 16px 0;
              color: #CCCCCC;
            }
            .mission-box {
              background: linear-gradient(135deg, #E8002D15, #E8002D08);
              border-left: 4px solid #E8002D;
              padding: 20px;
              border-radius: 8px;
              margin: 24px 0;
              border: 1px solid #333;
            }
            .mission-text {
              color: #E8002D;
              font-weight: 600;
              margin: 0 0 8px 0;
              font-size: 16px;
              text-transform: uppercase;
              letter-spacing: 1px;
            }
            .button { 
              background: linear-gradient(135deg, #E8002D 0%, #B8001F 100%);
              color: white !important; 
              padding: 18px 36px; 
              text-decoration: none; 
              border-radius: 8px; 
              display: inline-block; 
              margin: 24px 0;
              font-weight: 700;
              font-size: 16px;
              text-transform: uppercase;
              letter-spacing: 1px;
              transition: all 0.3s ease;
              box-shadow: 0 4px 15px rgba(232, 0, 45, 0.3);
              border: 2px solid #E8002D;
            }
            .button:hover {
              transform: translateY(-2px);
              box-shadow: 0 6px 25px rgba(232, 0, 45, 0.4);
            }
            .link-fallback {
              background: #1A1A1A;
              padding: 20px;
              border-radius: 8px;
              border-left: 4px solid #E8002D;
              margin: 20px 0;
              border: 1px solid #333;
            }
            .link-fallback p {
              margin: 0 0 8px 0;
              font-size: 14px;
              color: #CCCCCC;
            }
            .link-text {
              word-break: break-all; 
              color: #E8002D;
              font-family: 'Courier New', monospace;
              font-size: 12px;
              background-color: #333;
              padding: 12px;
              border-radius: 6px;
              border: 1px solid #444;
            }
            .security-notice {
              background: linear-gradient(135deg, #FF6B0015, #FF6B0008);
              border: 1px solid #FF6B00;
              border-radius: 8px;
              padding: 16px;
              margin: 20px 0;
            }
            .security-notice p {
              margin: 0;
              color: #FF6B00;
              font-size: 14px;
              font-weight: 600;
            }
            .features-grid {
              display: grid;
              grid-template-columns: 1fr 1fr;
              gap: 16px;
              margin: 24px 0;
            }
            .feature-item {
              background: #1A1A1A;
              padding: 16px;
              border-radius: 8px;
              border: 1px solid #333;
              text-align: center;
            }
            .feature-emoji {
              font-size: 24px;
              margin-bottom: 8px;
              display: block;
            }
            .feature-text {
              color: #CCCCCC;
              font-size: 13px;
              margin: 0;
            }
            .footer { 
              background: #1A1A1A; 
              padding: 30px; 
              text-align: center; 
              border-top: 2px solid #E8002D;
            }
            .footer p {
              margin: 0 0 8px 0;
              font-size: 12px; 
              color: #888;
              line-height: 1.5;
            }
            .footer a {
              color: #E8002D;
              text-decoration: none;
              font-weight: 600;
            }
            .footer .copyright {
              color: #E8002D;
              font-weight: 700;
              font-family: 'Bebas Neue', Impact, Arial, sans-serif;
              letter-spacing: 1px;
            }
            @media (max-width: 600px) {
              .features-grid {
                grid-template-columns: 1fr;
              }
              .container {
                margin: 0;
                border-radius: 0;
              }
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="logo-header">
              <!-- TuLink SVG Logo with fallback -->
              <svg class="logo-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="80" height="80">
                <rect width="1024" height="1024" fill="#0D0D0D"/>
                <defs>
                  <radialGradient id="gl-verify" cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stop-color="#E8002D" stop-opacity="0.18"/>
                    <stop offset="100%" stop-color="#E8002D" stop-opacity="0"/>
                  </radialGradient>
                </defs>
                <ellipse cx="512.00" cy="512.00" rx="431.72" ry="431.72" fill="url(#gl-verify)"/>
                <polygon points="163.840,163.840 791.893,163.840 860.160,860.160 232.107,860.160" fill="#E8002D"/>
                <text x="512.000" y="655.360" text-anchor="middle" dominant-baseline="auto" 
                      font-family="'Bebas Neue', Impact, 'Arial Narrow', sans-serif" 
                      font-size="409.600" font-weight="400" fill="#FFFFFF" letter-spacing="13.653">TL</text>
              </svg>
              
              <!-- Fallback logo for email clients that don't support SVG -->
              <!--[if !mso]><!-->
              <div class="logo-fallback" style="display:none;">
                <div class="logo-text">TL</div>
              </div>
              <!--<![endif]-->
              
              <h1 class="brand-name">TULINK</h1>
              <p class="tagline">Mission Control for Convoy Drivers</p>
            </div>
            
            <div class="header">
              <h1>Verify Your Email Address</h1>
            </div>
            
            <div class="content">
              <p><strong>Hello ${displayName || 'Driver'},</strong></p>
              
              <div class="mission-box">
                <p class="mission-text">Welcome to the convoy</p>
                <p style="margin: 0; color: #CCCCCC;">Join thousands of drivers who never leave anyone behind. Your mission-critical communication starts here.</p>
              </div>
              
              <p>To activate your TuLink mission control and start coordinating convoys, verify your email address:</p>
              
              <div style="text-align: center;">
                <a href="${verificationLink}" class="button">Verify Your Account</a>
              </div>
              
              <div class="link-fallback">
                <p><strong>Link not working?</strong> Copy and paste this verification URL:</p>
                <div class="link-text">${verificationLink}</div>
              </div>
              
              <div class="security-notice">
                <p><strong>Time Sensitive:</strong> This activation link expires in 1 hour for security protocols.</p>
              </div>
              
              <p style="color: #E8002D; font-weight: 600; margin: 24px 0 16px 0;">Once activated, your convoy capabilities include:</p>
              
              <div class="features-grid">
                <div class="feature-item">
                  <p class="feature-text">Real-time convoy tracking & coordination</p>
                </div>
                <div class="feature-item">
                  <p class="feature-text">Live location sharing with convoy members</p>
                </div>
                <div class="feature-item">
                  <p class="feature-text">Lag alerts & arrival coordination</p>
                </div>
                <div class="feature-item">
                  <p class="feature-text">Mission-critical convoy communications</p>
                </div>
              </div>
              
              <p style="font-size: 14px; color: #888;">If you didn't request convoy access, you can safely ignore this transmission.</p>
            </div>
            
            <div class="footer">
              <p class="copyright">© 2026 TULINK</p>
              <p>No one left behind</p>
              <p>This is an automated transmission. For convoy support: <a href="mailto:support@tulink.xyz">support@tulink.xyz</a></p>
            </div>
          </div>
        </body>
      </html>
    `;
  }

  async sendPasswordResetEmail(
    email: string,
    displayName: string,
    resetLink: string,
  ): Promise<boolean> {
    const subject = '🔐 TuLink Security Alert - Password Reset Request';
    const html = this.generatePasswordResetEmailHTML(displayName, resetLink);

    return this.sendEmail({
      to: email,
      subject,
      html,
      from: 'TuLink Security <security@tulink.xyz>',
    });
  }

  private generatePasswordResetEmailHTML(
    displayName: string,
    resetLink: string,
  ): string {
    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>TuLink Password Reset</title>
          <style>
            body { 
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, system-ui, sans-serif; 
              line-height: 1.6; 
              margin: 0; 
              padding: 0; 
              background-color: #0D0D0D;
              color: #FFFFFF;
            }
            .container { 
              max-width: 600px; 
              margin: 0 auto; 
              background-color: #0D0D0D;
              border-radius: 8px;
              overflow: hidden;
              box-shadow: 0 4px 20px rgba(232, 0, 45, 0.15);
              border: 1px solid #333;
            }
            .logo-header {
              text-align: center;
              padding: 30px;
              background: radial-gradient(circle at center, rgba(232, 0, 45, 0.18) 0%, rgba(232, 0, 45, 0) 70%);
            }
            .logo-svg {
              width: 80px;
              height: 80px;
              margin: 0 auto 20px;
              filter: drop-shadow(0 4px 8px rgba(0, 0, 0, 0.3));
              display: block;
            }
            .logo-fallback {
              width: 80px;
              height: 80px;
              margin: 0 auto 20px;
              background: #E8002D;
              border-radius: 12px;
              display: flex;
              align-items: center;
              justify-content: center;
              position: relative;
              transform: perspective(300px) rotateX(5deg);
            }
            .logo-text {
              font-family: 'Bebas Neue', Impact, 'Arial Black', Arial, sans-serif;
              font-size: 28px;
              font-weight: 400;
              color: #FFFFFF;
              letter-spacing: 2px;
              margin: 0;
            }
            .brand-name {
              font-family: 'Bebas Neue', Impact, 'Arial Black', Arial, sans-serif;
              font-size: 32px;
              font-weight: 400;
              color: #FFFFFF;
              margin: 0 0 8px 0;
              letter-spacing: 3px;
            }
            .tagline {
              color: #E8002D;
              font-size: 14px;
              font-weight: 600;
              text-transform: uppercase;
              letter-spacing: 1px;
              margin: 0;
            }
            .header { 
              background: linear-gradient(135deg, #FF6B00 0%, #E85D00 100%);
              color: white; 
              padding: 30px; 
              text-align: center;
              position: relative;
              overflow: hidden;
            }
            .header::before {
              content: '';
              position: absolute;
              top: 0;
              left: 0;
              right: 0;
              bottom: 0;
              background: linear-gradient(45deg, transparent 40%, rgba(255,255,255,0.1) 50%, transparent 60%);
            }
            .header h1 { 
              margin: 0; 
              font-size: 24px; 
              font-weight: 700;
              text-shadow: 0 2px 4px rgba(0,0,0,0.3);
              position: relative;
              z-index: 1;
            }
            .content { 
              padding: 40px 30px; 
              background: #0D0D0D;
            }
            .content p {
              margin: 0 0 16px 0;
              color: #CCCCCC;
            }
            .security-alert {
              background: linear-gradient(135deg, #FF6B0015, #FF6B0008);
              border-left: 4px solid #FF6B00;
              padding: 20px;
              border-radius: 8px;
              margin: 24px 0;
              border: 1px solid #FF6B00;
            }
            .security-text {
              color: #FF6B00;
              font-weight: 600;
              margin: 0 0 8px 0;
              font-size: 16px;
              text-transform: uppercase;
              letter-spacing: 1px;
            }
            .button { 
              background: linear-gradient(135deg, #E8002D 0%, #B8001F 100%);
              color: white !important; 
              padding: 18px 36px; 
              text-decoration: none; 
              border-radius: 8px; 
              display: inline-block; 
              margin: 24px 0;
              font-weight: 700;
              font-size: 16px;
              text-transform: uppercase;
              letter-spacing: 1px;
              transition: all 0.3s ease;
              box-shadow: 0 4px 15px rgba(232, 0, 45, 0.3);
              border: 2px solid #E8002D;
            }
            .button:hover {
              transform: translateY(-2px);
              box-shadow: 0 6px 25px rgba(232, 0, 45, 0.4);
            }
            .link-fallback {
              background: #1A1A1A;
              padding: 20px;
              border-radius: 8px;
              border-left: 4px solid #E8002D;
              margin: 20px 0;
              border: 1px solid #333;
            }
            .link-fallback p {
              margin: 0 0 8px 0;
              font-size: 14px;
              color: #CCCCCC;
            }
            .link-text {
              word-break: break-all; 
              color: #E8002D;
              font-family: 'Courier New', monospace;
              font-size: 12px;
              background-color: #333;
              padding: 12px;
              border-radius: 6px;
              border: 1px solid #444;
            }
            .expiry-notice {
              background: linear-gradient(135deg, #FFC10715, #FFC10708);
              border: 1px solid #FFC107;
              border-radius: 8px;
              padding: 16px;
              margin: 20px 0;
            }
            .expiry-notice p {
              margin: 0;
              color: #FFC107;
              font-size: 14px;
              font-weight: 600;
            }
            .footer { 
              background: #1A1A1A; 
              padding: 30px; 
              text-align: center; 
              border-top: 2px solid #E8002D;
            }
            .footer p {
              margin: 0 0 8px 0;
              font-size: 12px; 
              color: #888;
              line-height: 1.5;
            }
            .footer a {
              color: #E8002D;
              text-decoration: none;
              font-weight: 600;
            }
            .footer .copyright {
              color: #E8002D;
              font-weight: 700;
              font-family: 'Bebas Neue', Impact, Arial, sans-serif;
              letter-spacing: 1px;
            }
            @media (max-width: 600px) {
              .container {
                margin: 0;
                border-radius: 0;
              }
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="logo-header">
              <!-- TuLink SVG Logo with fallback -->
              <svg class="logo-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="80" height="80">
                <rect width="1024" height="1024" fill="#0D0D0D"/>
                <defs>
                  <radialGradient id="gl-reset" cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stop-color="#E8002D" stop-opacity="0.18"/>
                    <stop offset="100%" stop-color="#E8002D" stop-opacity="0"/>
                  </radialGradient>
                </defs>
                <ellipse cx="512.00" cy="512.00" rx="431.72" ry="431.72" fill="url(#gl-reset)"/>
                <polygon points="163.840,163.840 791.893,163.840 860.160,860.160 232.107,860.160" fill="#E8002D"/>
                <text x="512.000" y="655.360" text-anchor="middle" dominant-baseline="auto" 
                      font-family="'Bebas Neue', Impact, 'Arial Narrow', sans-serif" 
                      font-size="409.600" font-weight="400" fill="#FFFFFF" letter-spacing="13.653">TL</text>
              </svg>
              
              <!-- Fallback logo for email clients that don't support SVG -->
              <!--[if !mso]><!-->
              <div class="logo-fallback" style="display:none;">
                <div class="logo-text">TL</div>
              </div>
              <!--<![endif]-->
              
              <h1 class="brand-name">TULINK</h1>
              <p class="tagline">Mission Control for Convoy Drivers</p>
            </div>
            
            <div class="header">
              <h1>🔐 Password Reset Request</h1>
            </div>
            
            <div class="content">
              <p><strong>Hello ${displayName || 'Driver'},</strong></p>
              
              <div class="security-alert">
                <p class="security-text">🚨 Security Alert</p>
                <p style="margin: 0; color: #CCCCCC;">We received a request to reset the password for your TuLink convoy account. If this was you, proceed below.</p>
              </div>
              
              <p>To regain access to your convoy mission control and reset your password, click the secure reset button:</p>
              
              <div style="text-align: center;">
                <a href="${resetLink}" class="button">🔓 Reset Password</a>
              </div>
              
              <div class="link-fallback">
                <p><strong>🔧 Link not working?</strong> Copy and paste this secure reset URL:</p>
                <div class="link-text">${resetLink}</div>
              </div>
              
              <div class="expiry-notice">
                <p>⏰ <strong>Time Sensitive:</strong> This reset link expires in 1 hour for security protocols.</p>
              </div>
              
              <p style="color: #FF6B00; font-weight: 600; margin: 24px 0 16px 0;">⚠️ If you didn't request this password reset:</p>
              
              <ul style="color: #CCCCCC; padding-left: 20px;">
                <li>Your account is still secure - ignore this email</li>
                <li>Consider enabling two-factor authentication</li>
                <li>Review your recent convoy access logs</li>
                <li>Contact security if suspicious activity detected</li>
              </ul>
              
              <p style="font-size: 14px; color: #888; margin-top: 30px;">
                For convoy security support, contact: <a href="mailto:security@tulink.xyz" style="color: #E8002D;">security@tulink.xyz</a>
              </p>
            </div>
            
            <div class="footer">
              <p class="copyright">© 2026 TULINK</p>
              <p>Never leave anyone behind</p>
              <p>This is an automated security transmission. For convoy support: <a href="mailto:support@tulink.xyz">support@tulink.xyz</a></p>
            </div>
          </div>
        </body>
      </html>
    `;
  }

  async sendWelcomeEmail(email: string, displayName: string): Promise<boolean> {
    const subject = `🎯 Mission Activated - Welcome to TuLink, ${displayName}!`;
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <title>Mission Activated - TuLink</title>
          <style>
            body { 
              font-family: system-ui, sans-serif; 
              margin: 0; 
              padding: 0; 
              background-color: #0D0D0D;
              color: #FFFFFF;
            }
            .container { 
              max-width: 600px; 
              margin: 0 auto; 
              background-color: #0D0D0D;
              border: 1px solid #333;
            }
            .header { 
              background: linear-gradient(135deg, #E8002D 0%, #B8001F 100%);
              color: white; 
              padding: 40px 30px; 
              text-align: center;
            }
            .content { padding: 40px 30px; }
            .mission-complete {
              background: linear-gradient(135deg, #00C851, #007E33);
              padding: 20px;
              border-radius: 8px;
              text-align: center;
              margin: 20px 0;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>🎉 MISSION ACTIVATED</h1>
              <p style="margin: 0;">Your convoy credentials are verified</p>
            </div>
            <div class="content">
              <div class="mission-complete">
                <h2 style="margin: 0 0 10px 0;">✅ Welcome to TuLink Mission Control</h2>
                <p style="margin: 0;"><strong>${displayName}</strong>, your convoy communication system is now active.</p>
              </div>
              <p style="color: #CCCCCC;">You're now ready to coordinate convoys, share real-time locations, and ensure no one gets left behind.</p>
              <p style="color: #E8002D; font-weight: 600;">Start your first convoy mission today!</p>
            </div>
          </div>
        </body>
      </html>
    `;

    return this.sendEmail({ to: email, subject, html });
  }
}
