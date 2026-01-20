import { Module } from '@nestjs/common';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';
import { FcmService } from './services/fcm.service';
import { FirebaseModule } from '../../shared/firebase/firebase.module';

@Module({
  imports: [FirebaseModule],
  controllers: [NotificationController],
  providers: [NotificationService, FcmService],
  exports: [NotificationService],
})
export class NotificationModule {}
