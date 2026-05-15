import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FirebaseService } from '../../../shared/firebase/firebase.service';
import { ParticipantService } from '../../journey/services/participant.service';
import { LocationUpdate } from '../../../shared/interfaces/location.interface';
import { Journey } from '../../../shared/interfaces/journey.interface';
import { DistanceUtils } from '../../../common/utils/distance.utils';
import { FieldValue, DocumentSnapshot } from 'firebase-admin/firestore';

interface ParticipantData {
  status: string;
  role: string;
  userId: string;
  [key: string]: unknown;
}

export interface ArrivalResult {
  arrived: boolean;
  alreadyArrived: boolean;
  arrivedCount: number;
  totalCount: number;
  allArrived: boolean;
}

@Injectable()
export class ArrivalDetectionService {
  constructor(
    private firebaseService: FirebaseService,
    private participantService: ParticipantService,
    private configService: ConfigService,
  ) {}

  async detectArrival(
    update: LocationUpdate,
    journey: Journey,
  ): Promise<ArrivalResult> {
    const noArrival: ArrivalResult = {
      arrived: false,
      alreadyArrived: false,
      arrivedCount: 0,
      totalCount: 0,
      allArrived: false,
    };

    if (!journey.destination) {
      return noArrival;
    }

    const destinationCoords = {
      latitude: journey.destination.latitude,
      longitude: journey.destination.longitude,
    };

    const distanceToDestination = DistanceUtils.haversineDistance(
      update.location,
      destinationCoords,
    );

    const distanceThreshold =
      this.configService.get<number>('app.arrivalDistanceThresholdMeters') ??
      100;
    const speedThreshold =
      this.configService.get<number>('app.arrivalSpeedThresholdMps') ?? 1.39;

    const isWithinDistance = distanceToDestination < distanceThreshold;
    const isLowSpeed = !update.speed || update.speed < speedThreshold;

    if (!isWithinDistance || !isLowSpeed) {
      return noArrival;
    }

    const markResult = await this.markParticipantArrived(
      update.participantId,
      journey.id,
    );

    if (markResult.alreadyArrived) {
      return { ...noArrival, alreadyArrived: true };
    }

    const { arrivedCount, totalCount } = await this.getArrivalCounts(
      journey.id,
    );

    return {
      arrived: true,
      alreadyArrived: false,
      arrivedCount,
      totalCount,
      allArrived: arrivedCount >= totalCount && totalCount > 0,
    };
  }

  private async markParticipantArrived(
    participantId: string,
    journeyId: string,
  ): Promise<{ alreadyArrived: boolean }> {
    const participantDoc = await this.firebaseService.firestore
      .collection('journeys')
      .doc(journeyId)
      .collection('participants')
      .doc(participantId)
      .get();

    if (!participantDoc.exists) {
      return { alreadyArrived: false };
    }

    const participant = participantDoc.data() as ParticipantData | undefined;
    if (participant?.status === 'ARRIVED') {
      return { alreadyArrived: true };
    }

    await participantDoc.ref.update({
      status: 'ARRIVED',
      arrivedAt: FieldValue.serverTimestamp(),
    });

    return { alreadyArrived: false };
  }

  /**
   * Returns how many active participants have arrived vs total active participants.
   * Leader is included — they must also arrive or manually end for allArrived to be true.
   */
  async getArrivalCounts(
    journeyId: string,
  ): Promise<{ arrivedCount: number; totalCount: number }> {
    const snapshot = await this.firebaseService.firestore
      .collection('journeys')
      .doc(journeyId)
      .collection('participants')
      .where('status', 'in', ['ACTIVE', 'ACCEPTED', 'ARRIVED'])
      .get();

    const docs = snapshot.docs.map(
      (d: DocumentSnapshot) => d.data() as ParticipantData,
    );
    const arrivedCount = docs.filter((p) => p.status === 'ARRIVED').length;
    const totalCount = docs.length;

    return { arrivedCount, totalCount };
  }

  async getArrivedParticipants(journeyId: string): Promise<string[]> {
    const snapshot = await this.firebaseService.firestore
      .collection('journeys')
      .doc(journeyId)
      .collection('participants')
      .where('status', '==', 'ARRIVED')
      .get();

    return snapshot.docs.map((doc: DocumentSnapshot) => doc.id);
  }

  async allParticipantsArrived(journeyId: string): Promise<boolean> {
    const { arrivedCount, totalCount } = await this.getArrivalCounts(journeyId);
    return totalCount > 0 && arrivedCount >= totalCount;
  }
}
