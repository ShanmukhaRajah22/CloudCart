import mongoose from 'mongoose';

export async function connectToDB() {
    const uri = process.env.MONGODB_URI;

    if (!uri) {
        throw new Error('MONGODB_URI is not configured');
    }

    try {
        await mongoose.connect(uri);
    } catch (error) {
        console.error('Error connecting to MongoDB:', error);
    }

    console.log('MongoDB connected');
}